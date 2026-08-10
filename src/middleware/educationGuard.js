const IMAGE_GENERATION_PATTERNS = [
    /\b(generate|create|make|draw|render|paint|design|sketch|produce)\s+(an?\s+)?(image|picture|photo|illustration|drawing|diagram|sketch|graphic|wallpaper|avatar|art|portrait|poster)\b/i,
    /\b(image|picture|photo|drawing|illustration)\s+(generation|generator|creation)\b/i,
    /\b(generate|create|draw|make)\s+me\s+an?\s+(image|picture|photo|illustration)\b/i,
    /\bcan\s+you\s+(draw|paint|generate\s+an?\s+image|generate\s+a\s+picture)\b/i
];

const IMAGE_INPUT_PATTERNS = [
    /\b(look\s+at|analyze|read|scan|check|inspect|describe)\s+this\s+(image|picture|photo|screenshot|attachment|file|camera)\b/i,
    /\b(attached|uploaded)\s+(image|picture|photo|file|screenshot)\b/i,
    /\bfrom\s+this\s+(image|picture|photo|screenshot)\b/i,
    /\bimage\/(jpeg|png|webp|gif|bmp|tiff)\b/i,
    /\bdata:image\//i
];

const NON_EDUCATION_PATTERNS = [
    /\b(cricket\s+news|ipl\s+score|match\s+score|virat\s+kohli|rohit\s+sharma|ms\s+dhoni|football\s+score|fifa|messi|ronaldo|premier\s+league|nba\s+score|world\s+cup\s+score|sports\s+news|breaking\s+news|today'?s\s+news|latest\s+news)\b/i,
    /\b(latest\s+movie|tell\s+me\s+about\s+movies|bollywood|hollywood|box\s+office|netflix\s+movie|cinema\s+review|celebrity\s+gossip|actor|actress|pop\s+star|song\s+lyrics|movie\s+recommendation)\b/i,
    /\b(political\s+speech|political\s+leader|best\s+politician|best\s+political\s+leader|vote\s+for|election\s+campaign|political\s+party|who\s+should\s+i\s+vote|election\s+news|bjp\s+vs\s+congress|democrat\s+or\s+republican)\b/i,
    /\b(best\s+phone|best\s+smartphone|best\s+laptop\s+to\s+buy|buy\s+iphone|amazon\s+deal|discount\s+coupon|product\s+review|shopping\s+advice|which\s+car\s+to\s+buy)\b/i,
    /\b(stock\s+market\s+advice|cryptocurrency|bitcoin\s+price|crypto\s+trading|invest\s+in\s+stocks|trading\s+tips|forex\s+trading|shares\s+to\s+buy|get\s+rich\s+quick|mutual\s+funds\s+tips)\b/i,
    /\b(tell\s+me\s+a\s+joke|crack\s+a\s+joke|make\s+me\s+laugh|entertain\s+me|flirt|dating\s+advice|be\s+my\s+friend|are\s+you\s+single|casual\s+chat)\b/i,
    /\b(plan\s+a\s+vacation|plan\s+my\s+vacation|holiday\s+destination|book\s+a\s+flight|hotel\s+booking|tourism\s+guide|best\s+places\s+to\s+visit\s+on\s+holiday)\b/i,
    /\b(gambling|casino|sports\s+betting|lottery\s+numbers|poker\s+strategy)\b/i
];

const EDUCATION_INDICATOR_PATTERNS = [
    /\b(explain|what\s+is|what\s+are|how\s+does|how\s+do|why\s+does|why\s+is|define|definition|solve|calculate|derive|differentiate|integrate|prove|formula|theorem|law\s+of)\b/i,
    /\b(photosynthesis|pythagor(as|ean)|algebra|calculus|geometry|trigonometry|fraction|arithmetic|equation|polynomial|matrix|physics|chemistry|biology|science|gravity|force|velocity|atom|molecule|periodic\s+table|water\s+cycle|ecosystem|cell|dna|genetics|newton'?s?\s+(first|second|third)?\s*law)\b/i,
    /\b(grammar|noun|verb|adjective|pronoun|adverb|preposition|conjunction|tense|essay|comprehension|vocabulary|literature|history|geography|civics|social\s+studies|economics|computer\s+science|programming|coding|algorithm)\b/i,
    /\b(study\s+tips|exam\s+prep(aration)?|how\s+can\s+i\s+prepare|revision|syllabus|curriculum|class\s+\d+|grade\s+\d+|standard\s+\d+|ncert|cbse|icse|practice\s+questions|homework|lesson\s+plan)\b/i,
    /\b(schoolsync|attendance|timetable|marks|report\s+card|school\s+calendar|academic\s+calendar|fees?\s+structure|library|exam\s+schedule|exam\s+performance|student\s+attendance)\b/i
];

const HOMEWORK_DIRECT_ANSWER_PATTERNS = [
    /\b(give\s+(me\s+)?(only\s+)?the\s+final\s+answer|only\s+the\s+final\s+answer|final\s+answer\s+only|just\s+the\s+answer|just\s+give\s+me\s+the\s+answer|direct\s+answer\s+only|give\s+only\s+answer|solve\s+(this\s+)?and\s+give\s+(me\s+)?only\s+the\s+answer)\b/i,
    /\b(don'?t\s+explain|no\s+explanation|give\s+answer\s+without\s+explanation|just\s+the\s+value\s+of\s+[a-z])\b/i
];

function validateEducationPrompt({ message, contentType = '', body = {}, userRole = 'student' }) {
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return {
            allowed: false,
            errorType: 'VALIDATION_ERROR',
            message: 'Please provide a valid question.'
        };
    }

    const cleanMessage = message.trim();
    if (cleanMessage.length > 2000) {
        return {
            allowed: false,
            errorType: 'VALIDATION_ERROR',
            message: 'Question is too long. Please keep questions under 2000 characters.'
        };
    }

    const lowerContentType = String(contentType).toLowerCase();
    if (
        lowerContentType.includes('multipart/form-data') ||
        lowerContentType.startsWith('image/') ||
        body?.image ||
        body?.images ||
        body?.file ||
        body?.files ||
        body?.imageData ||
        body?.base64
    ) {
        return {
            allowed: false,
            errorType: 'IMAGE_INPUT_BLOCKED',
            message: 'Image input is not supported by SchoolSync AI. Please ask your question using text.'
        };
    }

    for (const pattern of IMAGE_INPUT_PATTERNS) {
        if (pattern.test(cleanMessage)) {
            return {
                allowed: false,
                errorType: 'IMAGE_INPUT_BLOCKED',
                message: 'Image input is not supported by SchoolSync AI. Please ask your question using text.'
            };
        }
    }

    for (const pattern of IMAGE_GENERATION_PATTERNS) {
        if (pattern.test(cleanMessage)) {
            return {
                allowed: false,
                errorType: 'IMAGE_GENERATION_BLOCKED',
                message: "I can't generate images. I can provide a text-based explanation of the topic."
            };
        }
    }

    for (const pattern of NON_EDUCATION_PATTERNS) {
        if (pattern.test(cleanMessage)) {
            return {
                allowed: false,
                errorType: 'NON_EDUCATION_REJECTED',
                message: 'Sorry, I can only help with education and SchoolSync-related questions.'
            };
        }
    }

    const hasEducationIndicator = EDUCATION_INDICATOR_PATTERNS.some(pattern => pattern.test(cleanMessage));
    const isObviousCasual = /^(hi|hello|hey|yo|howdy|sup|ok|okay|bye|good morning|good evening|good night|gm|gn)[.!?]*$/i.test(cleanMessage);
    if (isObviousCasual) {
        return {
            allowed: false,
            errorType: 'NON_EDUCATION_REJECTED',
            message: 'Sorry, I can only help with education and SchoolSync-related questions. Please ask an academic or school-related question!'
        };
    }

    const isHomeworkDirectAnswer = HOMEWORK_DIRECT_ANSWER_PATTERNS.some(pattern => pattern.test(cleanMessage));

    return {
        allowed: true,
        cleanMessage,
        isHomeworkDirectAnswer,
        userRole
    };
}

module.exports = { validateEducationPrompt, IMAGE_GENERATION_PATTERNS, IMAGE_INPUT_PATTERNS, NON_EDUCATION_PATTERNS, EDUCATION_INDICATOR_PATTERNS, HOMEWORK_DIRECT_ANSWER_PATTERNS };