const dotenv = require('dotenv');
dotenv.config();

async function createThread(message, gptModel = process.env.GPT_MODEL || 'gpt-4o') {
    const { channel, content } = message;
    if (typeof DEV !== 'undefined' && DEV) {
        console.log("3. Creating Thread...");
    }
    try {
        let thread = await message.startThread({
            name: content.slice(0, 100),
            autoArchiveDuration: 60,
            reason: "Synapsobot Response",
            appliedTags: [gptModel],
        });
        // console.log('thread: ', thread);
        return thread;
    } catch (error) {
        console.error(
            "An error occurred while creating a thread or sending a message:",
            error
        );
        throw error; // Rethrow the error to be handled by the caller
    }
}

module.exports = {
    createThread,
};