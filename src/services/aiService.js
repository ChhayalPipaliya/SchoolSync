const { GoogleGenAI } = require("@google/genai");

const SYSTEM_INSTRUCTION = `You are SchoolSync Education AI, a dedicated educational assistant embedded in the SchoolSync school management platform.
CORE RULES (never violate these):
1. You ONLY answer questions related to education, academic subjects, school management, or SchoolSync functionality.
2. You do NOT answer unrelated questions (sports news, entertainment, politics, shopping, cryptocurrency, casual chat, etc.).
3. You do NOT generate images, process images, or handle any file/image input.
4. You do NOT provide direct final answers to student homework — provide hints, Socratic guidance, step-by-step explanations, and similar examples instead.
5. Teachers may request practice questions, quiz generation, lesson outlines, and curriculum explanations.
6. Parents may ask about education guidance, helping children study, and general child academic support.
7. School Admins and Super Admins may ask about academic management, educational best practices, and SchoolSync features.
8. Librarians may ask about books, reading programs, library management, and educational resources.
9. Never expose private data from another student, parent, or school.
10. Keep all responses educational, clear, structured, and age-appropriate.`;

const ROLE_CONTEXT = {
    school_admin: "[SCHOOL ADMIN MODE] The user is a School Administrator. They may ask about academic management, staff training, educational programs, school operations, and SchoolSync features.",
    teacher: "[TEACHER ASSISTANCE MODE] The user is a Teacher. They may generate practice questions, create quizzes, design lesson plans, explain curricula, and request educational content for their class.",
    student: "[STUDENT LEARNING MODE] The user is a Student. Provide learning guidance, concept explanations, study tips, and hints. IMPORTANT: Do NOT provide direct final answers to homework. Use Socratic questioning and step-by-step guidance to help the student understand and solve problems themselves.",
    parent: "[PARENT SUPPORT MODE] The user is a Parent. Help them understand how to support their child's education, study strategies, and general academic guidance. Do not expose any other student's data.",
};

function isGeminiConfigured() {
    const key = process.env.GEMINI_API_KEY;
    return Boolean(key && key.trim().length > 0 && key !== "YOUR_EXISTING_KEY" && key !== "YOUR_GEMINI_API_KEY");
}

function buildContents(history, currentMessage) {
    const contents = [];

    for (const turn of history) {
        if (
            turn &&
            (turn.role === "user" || turn.role === "model") &&
            typeof turn.text === "string" &&
            turn.text.trim().length > 0
        ) {
            contents.push({
                role: turn.role,
                parts: [{ text: turn.text.trim() }]
            });
        }
    }

    contents.push({
        role: "user",
        parts: [{ text: currentMessage }]
    });

    return contents;
}

async function generateEducationResponse({
    message,
    userRole = "student",
    isHomeworkDirectAnswer = false,
    user = null,
    history = []
}) {
    if (!isGeminiConfigured()) {
        const error = new Error("Gemini AI is not configured.");
        error.isConfigError = true;
        throw error;
    }

    const apiKey = process.env.GEMINI_API_KEY.trim();

    const candidateModels = [
        process.env.GEMINI_MODEL,
        "gemini-2.5-flash",
        "gemini-2.0-flash",
        "gemini-2.0-flash-lite",
        "gemini-1.5-flash",
        "gemini-1.5-flash-8b"
    ].filter((v, i, a) => Boolean(v) && a.indexOf(v) === i);

    let contextualMessage = message;
    const roleCtx = ROLE_CONTEXT[userRole] || ROLE_CONTEXT.student;

    if (userRole === "student" && isHomeworkDirectAnswer) {
        contextualMessage =
            `[STUDENT HOMEWORK — LEARNING GUIDANCE REQUIRED]\n` +
            `The student asked: "${message}"\n` +
            `MANDATORY: Do NOT provide the final direct answer. ` +
            `Guide the student step-by-step with Socratic hints. ` +
            `Ask what operation to apply first, explain the concept, ` +
            `and help them solve it themselves.`;
    }

    const contents = buildContents(history, contextualMessage);
    const ai = new GoogleGenAI({ apiKey });
    let lastError = null;

    for (const modelName of candidateModels) {
        try {
            const response = await ai.models.generateContent({
                model: modelName,
                contents,
                config: {
                    systemInstruction: `${SYSTEM_INSTRUCTION}\n\n${roleCtx}`,
                    temperature: 0.4
                }
            });

            let responseText = "";
            if (typeof response.text === "function") {
                responseText = response.text();
            } else if (typeof response.text === "string") {
                responseText = response.text;
            } else if (response.candidates && response.candidates[0]?.content?.parts?.[0]?.text) {
                responseText = response.candidates[0].content.parts[0].text;
            }

            if (responseText && responseText.trim().length > 0) {
                return responseText.trim();
            }

            console.warn("[AI] Model returned empty response:", modelName);
        } catch (err) {
            lastError = err;
            const errMsg = err.message || String(err);
            const isRetryable =
                errMsg.includes("429") ||
                errMsg.includes("RESOURCE_EXHAUSTED") ||
                errMsg.includes("404") ||
                errMsg.includes("not found") ||
                errMsg.includes("no longer available") ||
                errMsg.includes("MODEL_NOT_FOUND") ||
                errMsg.includes("is not supported");

            if (isRetryable) {
                console.warn("[AI] Model unavailable, trying next:", modelName, "|", errMsg.slice(0, 120));
                continue;
            }

            console.error("[AI] Non-retryable Gemini error:", errMsg.slice(0, 200));
            break;
        }
    }

    if ( lastError && lastError.message && (lastError.message.includes("API_KEY_INVALID") || lastError.message.includes("API key not valid"))) {
        const configErr = new Error("Gemini AI is not configured.");
        configErr.isConfigError = true;
        throw configErr;
    }

    const safeErr = new Error("AI is temporarily unavailable. Please try again.");
    throw safeErr;
}

module.exports = { generateEducationResponse, isGeminiConfigured, SYSTEM_INSTRUCTION };