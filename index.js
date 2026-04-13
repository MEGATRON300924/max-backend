const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// Environment Variables (Hidden on Render)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

app.post('/ask-max', async (req, res) => {
    const { prompt } = req.body;

    try {
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                contents: [{
                    parts: [{
                        text: `You are Max AI Global. Your personality is a 'Supportive Hustler'. 
                        Theme: Blue and White. Tone: Concise, street-smart, and tactical. 
                        User Prompt: ${prompt}`
                    }]
                }]
            }
        );

        const reply = response.data.candidates[0].content.parts[0].text;
        res.json({ answer: reply });

    } catch (error) {
        console.error("Gemini Error:", error.message);
        res.status(500).json({ answer: "Bridge is down, Boss. Try again." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Max Backend running on port ${PORT}`));