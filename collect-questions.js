const { chromium } = require("playwright");
const fs = require("fs").promises;
const path = require("path");

const QUESTIONS_FILE = path.join(__dirname, "collected-questions.json");
const PRE_FILTERED_SEARCH_URL = "https://www.naukri.com/full-stack-developer-gen-ai-chatbot-natural-language-processing-artificial-intelligence-jobs?k=full%20stack%20developer%2C%20gen%20ai%2C%20chatbot%2C%20natural%20language%20processing%2C%20artificial%20intelligence&nignbevent_src=jobsearchDeskGNB&experience=5&ctcFilter=15to25&ctcFilter=25to50&jobAge=1";

let questionsData = {
  collectedAt: new Date().toISOString(),
  totalJobsApplied: 0,
  questions: []
};

async function loadQuestions() {
  try {
    const data = await fs.readFile(QUESTIONS_FILE, "utf8");
    questionsData = JSON.parse(data);
  } catch (e) {
    // Start fresh
  }
}

async function saveQuestions() {
  await fs.writeFile(QUESTIONS_FILE, JSON.stringify(questionsData, null, 2));
}

async function collectQuestionsFromModal(page) {
  const questions = [];
  let iter = 0;
  const maxIter = 50;
  const seenQuestions = new Set();

  while (iter < maxIter) {
    await page.waitForTimeout(1500);
    
    // Check if modal is still open
    const modalExists = await page.evaluate(() => {
      return document.querySelector('.chatbot_DrawerContentWrapper, [class*="chatbot"]') !== null;
    });

    if (!modalExists) {
      console.log("  Modal closed, application complete");
      break;
    }

    // Get modal body text
    const body = await page.evaluate(() => {
      const modal = document.querySelector('.chatbot_DrawerContentWrapper, [class*="chatbot"]');
      return modal ? modal.textContent.trim() : "";
    });

    if (!body || body.length < 10) {
      await page.waitForTimeout(1000);
      continue;
    }

    // Extract ALL question texts from modal (including previous ones)
    const allQuestionTexts = await page.evaluate(() => {
      const modal = document.querySelector('.chatbot_DrawerContentWrapper');
      if (!modal) return [];
      
      // Get all bot messages/questions
      const botMsgs = Array.from(modal.querySelectorAll('.botMsg, .botItem, [class*="botMsg"], [class*="botItem"]'));
      const questions = botMsgs.map(msg => {
        const text = msg.textContent.trim();
        // Filter out greeting messages
        if (text.length > 10 && 
            !text.includes('Hi ') && 
            !text.includes('thank you for showing interest') &&
            !text.includes('Kindly answer') &&
            !text.includes('recruiter\'s questions')) {
          return text;
        }
        return null;
      }).filter(q => q);
      
      return questions;
    });

    // Get current question (last one)
    const currentQuestion = allQuestionTexts[allQuestionTexts.length - 1] || "";

    // Collect current question if not seen before
    if (currentQuestion && !seenQuestions.has(currentQuestion)) {
      seenQuestions.add(currentQuestion);
      
      // Detect question type and options
      const questionInfo = await page.evaluate(() => {
        const modal = document.querySelector('.chatbot_DrawerContentWrapper');
        if (!modal) return { type: "unknown", hasRadios: false, hasInput: false, radioOptions: [] };
        
        const radios = Array.from(modal.querySelectorAll('input[type="radio"]'));
        const inputs = modal.querySelectorAll('[contenteditable="true"], input[type="text"], input[type="number"], input[type="date"]');
        
        const radioOptions = radios.map(r => ({
          id: r.id,
          value: r.value,
          name: r.name,
          label: r.closest('label')?.textContent.trim() || r.nextElementSibling?.textContent.trim() || ""
        }));
        
        return {
          type: radios.length > 0 ? "radio" : inputs.length > 0 ? "text" : "unknown",
          hasRadios: radios.length > 0,
          hasInput: inputs.length > 0,
          radioOptions: radioOptions
        };
      });
      
      questions.push({
        question: currentQuestion,
        type: questionInfo.type,
        radioOptions: questionInfo.radioOptions,
        timestamp: new Date().toISOString()
      });
      
      console.log(`  [Question ${questions.length}] ${questionInfo.type}: ${currentQuestion.substring(0, 100)}${currentQuestion.length > 100 ? '...' : ''}`);
    }

    // Answer the question to proceed
    let answered = false;
    
    // 1. Try radio buttons - select Yes or first option
    if (await page.locator('input[type="radio"]').count() > 0) {
      const yesRadio = page.locator('input[type="radio"][id="Yes"], input[type="radio"][value="Yes"]').first();
      if (await yesRadio.isVisible({ timeout: 500 }).catch(() => false)) {
        await yesRadio.click().catch(() => {});
        answered = true;
      } else {
        // Click first radio option
        await page.locator('input[type="radio"]').first().click().catch(() => {});
        answered = true;
      }
      await page.waitForTimeout(500);
    }
    
    // 2. Fill text inputs based on question content
    if (!answered) {
      const inp = page.locator('[contenteditable="true"], input[type="text"], input[type="number"], input[type="date"]').first();
      if (await inp.isVisible({ timeout: 500 }).catch(() => false)) {
        let fillValue = "";
        
        // Determine what to fill based on question
        if (/experience|years of exp|Total experience/i.test(body)) {
          fillValue = "5";
        } else if (/current CTC|current salary/i.test(body)) {
          fillValue = "Not Disclosed";
        } else if (/expected CTC|expected salary/i.test(body)) {
          fillValue = "25";
        } else if (/date of birth|DOB|birth/i.test(body)) {
          fillValue = "05/01/1998";
        } else if (/last working day|when can you join|date of joining/i.test(body)) {
          const today = new Date();
          const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 15);
          fillValue = `${String(nextMonth.getDate()).padStart(2, '0')}/${String(nextMonth.getMonth() + 1).padStart(2, '0')}/${nextMonth.getFullYear()}`;
        } else if (/experience/i.test(body)) {
          fillValue = "5";
        } else {
          fillValue = ""; // Leave empty for unknown questions
        }
        
        if (fillValue) {
          await inp.click();
          await page.waitForTimeout(200);
          await inp.evaluate((el, val) => {
            if (el.isContentEditable || el.getAttribute?.('contenteditable') === 'true') {
              el.textContent = val;
            } else {
              el.value = val;
            }
            el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
          }, fillValue);
          answered = true;
          await page.waitForTimeout(500);
        }
      }
    }

    // Wait for Save button to become enabled
    let saveEnabled = false;
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(500);
      const enabled = await page.evaluate(() => {
        const sendDiv = document.querySelector('.sendMsgbtn_container .send:not(.disabled)');
        return sendDiv !== null;
      });
      if (enabled) {
        saveEnabled = true;
        break;
      }
    }

    // Click Save
    if (saveEnabled || answered) {
      const saveBtn = page.locator('.sendMsgbtn_container .send:not(.disabled) .sendMsg, button:has-text("Save"):not([class*="save-job"])').first();
      if (await saveBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await saveBtn.click();
        await page.waitForTimeout(2000);
      } else {
        // Check if application is complete (no more questions)
        const stillOpen = await page.evaluate(() => {
          return document.querySelector('.chatbot_DrawerContentWrapper') !== null;
        });
        if (!stillOpen) break;
      }
    } else {
      // No answer provided and Save not enabled - might be stuck
      console.log("  Warning: Could not answer question or Save not enabled");
      await page.waitForTimeout(2000);
    }

    iter++;
  }

  return questions;
}

async function applyToJobAndCollect(page, jobUrl, jobTitle) {
  try {
    console.log(`\n[Job ${questionsData.totalJobsApplied + 1}] Applying to: ${jobTitle}`);
    await page.goto(jobUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(2000);

    // Find Apply button
    const applyBtn = page.locator('#apply-button, button.apply-button, #walkin-button, button:has-text("Apply"), button:has-text("I am interested")').first();
    if (await applyBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await applyBtn.click();
      await page.waitForTimeout(3000);

      // Collect questions from modal
      const questions = await collectQuestionsFromModal(page);
      
      if (questions.length > 0) {
        questionsData.questions.push({
          jobTitle: jobTitle,
          jobUrl: jobUrl,
          questions: questions,
          collectedAt: new Date().toISOString()
        });
        questionsData.totalJobsApplied++;
        await saveQuestions();
        console.log(`  ✓ Collected ${questions.length} questions`);
      }
    }
  } catch (e) {
    console.error(`  ✗ Error: ${e.message}`);
  }
}

async function main() {
  await loadQuestions();
  console.log("Starting question collection...");
  console.log("Browser will open in visible mode - you can watch the automation");
  console.log(`Target: Apply to 20 jobs and collect all questions\n`);
  
  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 500 // Slow down actions so you can see what's happening
  });
  const page = await browser.newPage();

  try {
    await page.goto(PRE_FILTERED_SEARCH_URL, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(3000);

    let jobsApplied = 0;
    const targetJobs = 20;

    while (jobsApplied < targetJobs) {
      // Extract jobs from current page
      const jobs = await page.evaluate(() => {
        const cards = document.querySelectorAll('div.cust-job-tuple, [class*="sjw__tuple"], .jobTuple, article[class*="tuple"]');
        return Array.from(cards).slice(0, 20).map(card => {
          const link = card.querySelector('a.title[href*="job-listings"], a[href*="job-listings"]');
          const title = card.querySelector('.title, [class*="title"]');
          return {
            url: link ? link.href : "",
            title: title ? title.textContent.trim() : ""
          };
        }).filter(j => j.url && j.title);
      });

      if (jobs.length === 0) break;

      for (const job of jobs) {
        if (jobsApplied >= targetJobs) break;
        
        await applyToJobAndCollect(page, job.url, job.title);
        jobsApplied = questionsData.totalJobsApplied;
        
        // Go back to search page
        await page.goto(PRE_FILTERED_SEARCH_URL, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(2000);
      }

      // Try next page
      const nextBtn = page.locator('a:has-text("Next"), button:has-text("Next"), [aria-label="Next"]').first();
      if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await nextBtn.click();
        await page.waitForTimeout(3000);
      } else {
        break;
      }
    }

    console.log(`\n✓ Completed! Applied to ${questionsData.totalJobsApplied} jobs`);
    console.log(`✓ Total questions collected: ${questionsData.questions.reduce((sum, q) => sum + q.questions.length, 0)}`);
    
  } catch (e) {
    console.error("Error:", e);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
