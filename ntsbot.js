const { Client, GatewayIntentBits } = require('discord.js');
const { createAudioPlayer, createAudioResource, joinVoiceChannel, AudioPlayerStatus, getVoiceConnection, NoSubscriberBehavior, StreamType } = require('@discordjs/voice');
const { spawn } = require('child_process');
const { Readable } = require('stream');

// Create a new client instance
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

const TOKEN = 'YOUR_BOT_TOKEN';
const NTS_LIVE_STREAM = 'https://stream-relay-geo.ntslive.net/stream';

let currentFFmpegProcess = null;
let currentCurlProcess = null;

function createFFmpegStream(url) {
    // Kill any existing processes
    if (currentFFmpegProcess) {
        try {
            currentFFmpegProcess.kill();
        } catch (e) {
            console.error('Error killing previous FFmpeg process:', e);
        }
    }
    if (currentCurlProcess) {
        try {
            currentCurlProcess.kill();
        } catch (e) {
            console.error('Error killing previous curl process:', e);
        }
    }

    // Create a curl process to fetch the stream
    currentCurlProcess = spawn('curl', ['-L', '--silent', url]);
    
    // Create FFmpeg process that reads from curl's output
    currentFFmpegProcess = spawn('ffmpeg', [
        '-i', 'pipe:0',         // Read from stdin
        '-f', 's16le',          // PCM 16-bit little-endian format
        '-ar', '48000',         // Sample rate
        '-ac', '2',             // Stereo
        '-acodec', 'pcm_s16le', // PCM codec
        '-loglevel', 'error',   // Only show errors
        'pipe:1'                // Output to stdout
    ]);

    // Pipe curl output to FFmpeg input
    currentCurlProcess.stdout.pipe(currentFFmpegProcess.stdin);

    // Handle curl errors
    currentCurlProcess.on('error', (error) => {
        console.error('Curl process error:', error);
    });

    currentCurlProcess.stderr.on('data', (data) => {
        console.error(`Curl stderr: ${data}`);
    });

    // Handle FFmpeg errors
    currentFFmpegProcess.on('error', (error) => {
        console.error('FFmpeg process error:', error);
    });

    currentFFmpegProcess.stderr.on('data', (data) => {
        console.error(`FFmpeg stderr: ${data}`);
    });

    // Create a readable stream from FFmpeg's stdout
    const outputStream = new Readable();
    outputStream._read = () => {}; // _read is required but we don't need to implement it

    currentFFmpegProcess.stdout.on('data', (chunk) => {
        outputStream.push(chunk);
    });

    currentFFmpegProcess.stdout.on('end', () => {
        outputStream.push(null);
    });

    // Handle process cleanup
    currentFFmpegProcess.on('close', (code) => {
        console.log(`FFmpeg process closed with code ${code}`);
        currentFFmpegProcess = null;
        if (currentCurlProcess) {
            currentCurlProcess.kill();
            currentCurlProcess = null;
        }
    });

    currentCurlProcess.on('close', (code) => {
        console.log(`Curl process closed with code ${code}`);
        currentCurlProcess = null;
        if (currentFFmpegProcess) {
            currentFFmpegProcess.kill();
            currentFFmpegProcess = null;
        }
    });

    return outputStream;
}

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

let retryCount = 0;
const MAX_RETRIES = 3;
let currentPlayer = null;

// Handle voice channel join/leave events
client.on('voiceStateUpdate', async (oldState, newState) => {
    // If a user joins a voice channel (and it's not the bot itself)
    if (!oldState.channelId && newState.channelId && !newState.member.user.bot) {
        console.log('User joined channel, attempting to connect...');
        try {
            const connection = joinVoiceChannel({
                channelId: newState.channelId,
                guildId: newState.guild.id,
                adapterCreator: newState.guild.voiceAdapterCreator,
                selfDeaf: false
            });

            console.log('Successfully joined voice channel');

            // Destroy any existing player
            if (currentPlayer) {
                currentPlayer.stop();
            }

            currentPlayer = createAudioPlayer({
                behaviors: {
                    noSubscriber: NoSubscriberBehavior.Play
                }
            });

            try {
                console.log('Attempting to create audio resource...');
                const stream = createFFmpegStream(NTS_LIVE_STREAM);
                const resource = createAudioResource(stream, {
                    inputType: StreamType.Raw, // Changed to Raw for PCM format
                    inlineVolume: true
                });

                currentPlayer.play(resource);
                connection.subscribe(currentPlayer);
                console.log('Started playing stream');
                retryCount = 0;

                currentPlayer.on(AudioPlayerStatus.Playing, () => {
                    console.log('Audio player status: Playing');
                    retryCount = 0; // Reset retry count on successful play
                });

                currentPlayer.on(AudioPlayerStatus.Buffering, () => {
                    console.log('Audio player status: Buffering');
                });

                currentPlayer.on(AudioPlayerStatus.Idle, () => {
                    console.log(`Audio player status: Idle (Retry ${retryCount + 1}/${MAX_RETRIES})`);
                    if (retryCount < MAX_RETRIES) {
                        retryCount++;
                        setTimeout(() => {
                            try {
                                const newStream = createFFmpegStream(NTS_LIVE_STREAM);
                                const newResource = createAudioResource(newStream, {
                                    inputType: StreamType.Raw, // Changed to Raw for PCM format
                                    inlineVolume: true
                                });
                                currentPlayer.play(newResource);
                            } catch (error) {
                                console.error('Failed to restart stream:', error);
                            }
                        }, 5000); // Wait 5 seconds before retrying
                    } else {
                        console.log('Max retries reached, stopping reconnection attempts');
                    }
                });

                currentPlayer.on('error', error => {
                    console.error('Player error:', error);
                });

            } catch (resourceError) {
                console.error('Error creating audio resource:', resourceError);
            }

        } catch (error) {
            console.error('Failed to join voice channel:', error);
        }
    }

    // Check if someone left a channel
    if (oldState.channelId) {
        const oldChannel = oldState.channel;
        if (oldChannel) {
            const humanMembers = oldChannel.members.filter(member => !member.user.bot);
            if (humanMembers.size === 0) {
                console.log('No human members left in channel, disconnecting...');
                const connection = getVoiceConnection(oldState.guild.id);
                if (connection) {
                    if (currentPlayer) {
                        currentPlayer.stop();
                    }
                    if (currentFFmpegProcess) {
                        currentFFmpegProcess.kill();
                    }
                    if (currentCurlProcess) {
                        currentCurlProcess.kill();
                    }
                    connection.destroy();
                    console.log('Bot left channel as it was alone');
                }
            }
        }
    }
});

// Keep the stop command for manual control
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content.toLowerCase() === '!stopnts') {
        const connection = getVoiceConnection(message.guild.id);
        if (connection) {
            if (currentPlayer) {
                currentPlayer.stop();
            }
            if (currentFFmpegProcess) {
                currentFFmpegProcess.kill();
            }
            if (currentCurlProcess) {
                currentCurlProcess.kill();
            }
            connection.destroy();
            message.reply('👋 Stopped playing NTS Live.');
        } else {
            message.reply('I am not in a voice channel!');
        }
    }
});

process.on('uncaughtException', error => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

client.login(TOKEN);
