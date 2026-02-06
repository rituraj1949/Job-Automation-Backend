const io = require('socket.io-client');

// Connect to the server
const socket = io('http://localhost:3000', {
    reconnectionDelayMax: 10000,
});

socket.on('connect', () => {
    console.log('Connected to server with ID:', socket.id);

    // 1. Send 'agent_data' - Jobs Extracted
    const jobsPayload = {
        type: 'jobs_extracted',
        data: JSON.stringify([
            { title: 'Software Engineer', company: 'Tech Corp', location: 'Remote' },
            { title: 'Product Manager', company: 'Biz Inc', location: 'New York' }
        ]),
        timestamp: Date.now()
    };
    socket.emit('agent_data', jobsPayload);
    console.log('Sent jobs_extracted event');

    // 2. Send 'agent_data' - Emails Found
    const emailsPayload = {
        type: 'emails_found',
        data: JSON.stringify(['test@example.com', 'hr@techcorp.com']),
        timestamp: Date.now()
    };
    socket.emit('agent_data', emailsPayload);
    console.log('Sent emails_found event');

});

// Listen for commands from the server
socket.on('command', (payload) => {
    console.log('Received command from server:', payload);
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
});

// Keep the script running for a bit to receive potential commands
setTimeout(() => {
    console.log('Test finished, exiting...');
    socket.close();
    process.exit(0);
}, 5000);
