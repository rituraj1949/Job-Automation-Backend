const io = require('socket.io-client');

// Connect to the REMOTE PRODUCTION server
const socket = io('https://job-automation-backend-skfs.onrender.com/', {
    reconnectionDelayMax: 10000,
});

socket.on('connect', () => {
    console.log('Connected to PRODUCTION server with ID:', socket.id);

    // 1. Send 'agent_data' - Jobs Extracted
    const jobsPayload = {
        type: 'jobs_extracted',
        data: JSON.stringify([
            { title: 'TEST JOB - IF YOU SEE THIS, IT WORKS', company: 'Verification Inc', location: 'Cloud' }
        ]),
        timestamp: Date.now()
    };
    socket.emit('agent_data', jobsPayload);
    console.log('Sent TEST jobs_extracted event');

    // 2. Send 'agent_data' - Emails Found
    const emailsPayload = {
        type: 'emails_found',
        data: JSON.stringify(['verification@test.com']),
        timestamp: Date.now()
    };
    socket.emit('agent_data', emailsPayload);
    console.log('Sent TEST emails_found event');
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
});

// Keep the script running briefly
setTimeout(() => {
    console.log('Test finished, exiting...');
    socket.close();
    process.exit(0);
}, 5000);
