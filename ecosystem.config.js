module.exports = {
    apps: [{
        name: "whatsapp-sender",
        script: "app.js",
        env: {
            NODE_ENV: "production",
            PORT: 3000
        },
        error_file: "logs/err.log",
        out_file: "logs/out.log",
        time: true
    }]
};
