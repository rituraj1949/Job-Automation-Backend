const io = require('socket.io-client');

const socket = io('https://job-automation-backend-skfs.onrender.com/', {
    reconnectionDelayMax: 10000,
});

socket.on('connect', () => {
    console.log('Connected to server. Sending data loop...');

    let count = 1;
    const interval = setInterval(() => {
        socket.emit('agent_data', {
            type: 'jobs_extracted',
            data: `Test Job #${count} (Live Check)`,
            timestamp: Date.now()
        });
        console.log(`Sent Test Job #${count}`);
        count++;

        if (count > 20) {
            clearInterval(interval);
            socket.close();
            process.exit(0);
        }
    }, 2000); // Send every 2 seconds
});
