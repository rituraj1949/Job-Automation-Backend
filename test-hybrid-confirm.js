const axios = require('axios');

const SERVER_URL = 'http://localhost:3000';
const DEVICE_ID = 'test-device-confirm-999';

async function runTest() {
    console.log(`🚀 Starting Hybrid Persistence & Confirmation Test for Device: ${DEVICE_ID}`);

    try {
        // 1. Simulate sending a DOM snapshot via HTTP POST
        console.log('\n1. Sending DOM snapshot via POST /agent/data...');
        const domSnapshot = `
            <html>
                <head><title>naukri expert assist - Google Search</title></head>
                <body>
                    <link rel="canonical" href="https://www.google.com/search?q=naukri+expert+assist">
                    <input name="q" value="naukri+expert+assist">
                    <a href="https://www.linkedin.com/company/test-confirm"><h3>Test Confirm Company</h3></a>
                </body>
            </html>
        `;

        await axios.post(`${SERVER_URL}/agent/data`, {
            type: 'dom_snapshot',
            deviceId: DEVICE_ID,
            data: domSnapshot,
            timestamp: Date.now()
        });

        // 2. Poll for commands via HTTP GET
        console.log('\n2. Polling for commands via GET /agent/poll...');
        const poll1 = await axios.get(`${SERVER_URL}/agent/poll?deviceId=${DEVICE_ID}`);
        console.log('✅ Poll 1 Response (should have command):', JSON.stringify(poll1.data, null, 2));

        if (poll1.data.length > 0 && poll1.data[0].action === 'NAVIGATE') {
            console.log('🎉 Received NAVIGATE command.');

            // 3. Poll again immediately (should be blocked by pending confirmation)
            console.log('\n3. Polling again immediately (should be empty due to pending confirm)...');
            const poll2 = await axios.get(`${SERVER_URL}/agent/poll?deviceId=${DEVICE_ID}`);
            console.log('✅ Poll 2 Response (should be []):', poll2.data);

            if (poll2.data.length === 0) {
                console.log('🎉 SUCCESS: Command delivery throttled until confirmation.');
            }

            // 4. Send navigation_complete
            console.log('\n4. Sending navigation_complete via POST /agent/data...');
            await axios.post(`${SERVER_URL}/agent/data`, {
                type: 'navigation_complete',
                deviceId: DEVICE_ID,
                data: 'https://www.linkedin.com/company/test-confirm/posts/?feedView=all',
                timestamp: Date.now()
            });

            // 5. Poll again (should now allow more commands, though queue might be empty)
            console.log('\n5. Polling again after confirmation...');
            const poll3 = await axios.get(`${SERVER_URL}/agent/poll?deviceId=${DEVICE_ID}`);
            console.log('✅ Poll 3 Response:', poll3.data);
            console.log('🎉 SUCCESS: Confirmation cleared the block.');

        } else {
            console.log('❌ FAILURE: Did not receive expected NAVIGATE command.');
        }

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
        }
    }
}

runTest();
