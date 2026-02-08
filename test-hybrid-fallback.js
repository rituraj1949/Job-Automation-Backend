const axios = require('axios');

const SERVER_URL = 'http://localhost:3000';
const DEVICE_ID = 'test-device-999';

async function runTest() {
    console.log(`🚀 Starting Hybrid Fallback Test for Device: ${DEVICE_ID}`);

    try {
        // 1. Simulate sending a DOM snapshot via HTTP POST
        console.log('\n1. Sending DOM snapshot via POST /agent/data...');
        const domSnapshot = `
            <html>
                <head><title>naukri expert assist - Google Search</title></head>
                <body>
                    <link rel="canonical" href="https://www.google.com/search?q=naukri+expert+assist">
                    <input name="q" value="naukri expert assist">
                    <a href="https://www.linkedin.com/company/test-company"><h3>Test Company</h3></a>
                </body>
            </html>
        `;

        const dataResponse = await axios.post(`${SERVER_URL}/agent/data`, {
            type: 'dom_snapshot',
            deviceId: DEVICE_ID,
            data: domSnapshot,
            timestamp: Date.now()
        });

        console.log('✅ POST /agent/data response:', dataResponse.data);

        // 2. Poll for commands via HTTP GET
        console.log('\n2. Polling for commands via GET /agent/poll...');
        const pollResponse = await axios.get(`${SERVER_URL}/agent/poll?deviceId=${DEVICE_ID}`);

        console.log('✅ GET /agent/poll response:', JSON.stringify(pollResponse.data, null, 2));

        if (pollResponse.data.length > 0) {
            console.log('\n🎉 SUCCESS: Received queued command via HTTP poll!');
        } else {
            console.log('\n❌ FAILURE: No commands received. Check server logs.');
        }

        // 3. Verify queue is cleared
        console.log('\n3. Polling again to verify queue is cleared...');
        const secondPoll = await axios.get(`${SERVER_URL}/agent/poll?deviceId=${DEVICE_ID}`);
        console.log('✅ Second poll response (should be empty):', secondPoll.data);

        if (secondPoll.data.length === 0) {
            console.log('🎉 SUCCESS: Queue cleared after retrieval.');
        }

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
        }
    }
}

runTest();
