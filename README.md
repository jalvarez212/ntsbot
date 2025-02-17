# NTS Discord Bot

A Discord bot that automatically plays NTS radio in voice channels.

## Installation

1. Install Node.js and npm on your server:
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

2. Install PM2 globally:
```bash
sudo npm install -g pm2
```

3. Clone this repository and install dependencies:
```bash
git clone <your-repo-url>
cd ntsbot
npm install
```

4. Start the bot with PM2:
```bash
pm2 start ntsbot.js --name "ntsbot"
```

## Useful PM2 Commands

- View logs: `pm2 logs ntsbot`
- Monitor processes: `pm2 monit`
- Stop bot: `pm2 stop ntsbot`
- Restart bot: `pm2 restart ntsbot`
- Set up PM2 to start on system boot: `pm2 startup` (follow the instructions it provides)
- Save the current PM2 process list: `pm2 save`

## Configuration

Make sure to:
1. Update the Discord bot token in `ntsbot.js`
2. Ensure all dependencies are installed: Node.js, FFmpeg, Opus

## Troubleshooting

If you encounter audio issues:
1. Make sure FFmpeg is installed: `sudo apt-get install ffmpeg`
2. Check PM2 logs for errors: `pm2 logs ntsbot`
3. Ensure the bot has proper permissions in Discord
