const axios = require('axios');

const SERVER_URL = 'http://localhost:3000';
const DEVICE_ID = 'test-scroll-direct-999';

async function runTest() {
    console.log(`🚀 Starting Direct LinkedIn Scroll Test for Device: ${DEVICE_ID}`);

    try {
        // 1. We need to "pre-seed" a pending confirmation so the server knows which URL was confirmed.
        // In server.js, pendingConfirmations is populated when sendAgentCommand(NAVIGATE) is called.
        // Since we can't easily trigger that without the full brain flow, 
        // we'll just simulate a DOM snapshot that RESULTS in a NAVIGATE command first.

        console.log('\n1. Sending DOM to trigger a NAVIGATE command...');
        const domSnapshot = `
            <html>
                <head><title>naukri expert assist - Google Search</title></head>
                <body>
                    <link rel="canonical" href="https://www.google.com/search?q=naukri+expert+assist">
                    <a href="https://www.linkedin.com/showcase/naukri-expert-assist"><h3>Naukri Showcase</h3></a>
                </body>
            </html>
        `;

        await axios.post(`${SERVER_URL}/agent/data`, {
            type: 'dom_snapshot',
            deviceId: DEVICE_ID,
            data: domSnapshot,
            timestamp: Date.now()
        });

        // 2. Poll to ensure the NAVIGATE command was generated and tracked
        console.log('\n2. Polling for the NAVIGATE command...');
        const poll1 = await axios.get(`${SERVER_URL}/agent/poll?deviceId=${DEVICE_ID}`);
        console.log('✅ Poll 1 Result:', JSON.stringify(poll1.data, null, 2));

        if (poll1.data.length > 0 && poll1.data[0].action === 'NAVIGATE') {
            const confirmedUrl = poll1.data[0].value;
            console.log(`🎉 Success! Targeted URL is: ${confirmedUrl}`);

            // 3. Send navigation_complete
            console.log('\n3. Sending navigation_complete (triggers 5x scrolls)...');
            await axios.post(`${SERVER_URL}/agent/data`, {
                type: 'navigation_complete',
                deviceId: DEVICE_ID,
                data: confirmedUrl,
                timestamp: Date.now()
            });

            // 4. Poll every 2.5 seconds to see the scrolls arrive
            console.log('\n4. Watching command queue (polling 6 times every 2.5s)...');
            for (let i = 1; i <= 6; i++) {
                await new Promise(resolve => setTimeout(resolve, 2500));
                const pollMsg = await axios.get(`${SERVER_URL}/agent/poll?deviceId=${DEVICE_ID}`);
                console.log(`📦 Poll #${i} at T+${i * 2.5}s:`, JSON.stringify(pollMsg.data, null, 2));
            }

            console.log('\n🎉 Test finished. Check server logs for [SCROLL] markers.');
        } else {
            console.log('❌ FAILURE: NAVIGATE command not found. Brain might have skipped the link.');
        }

    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

runTest();
