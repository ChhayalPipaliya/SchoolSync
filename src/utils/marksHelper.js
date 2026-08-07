function calculateGrade(obtainedMarks, maxMarks) {
    if (!obtainedMarks || !maxMarks || maxMarks === 0) return { grade: 'E', gradePoint: 0.0 };
    const pct = (parseFloat(obtainedMarks) / parseFloat(maxMarks)) * 100;
    if (pct >= 91) return { grade: 'A1', gradePoint: 10.0 };
    if (pct >= 81) return { grade: 'A2', gradePoint: 9.0 };
    if (pct >= 71) return { grade: 'B1', gradePoint: 8.0 };
    if (pct >= 61) return { grade: 'B2', gradePoint: 7.0 };
    if (pct >= 51) return { grade: 'C1', gradePoint: 6.0 };
    if (pct >= 41) return { grade: 'C2', gradePoint: 5.0 };
    if (pct >= 33) return { grade: 'D', gradePoint: 4.0 };
    return { grade: 'E', gradePoint: 0.0 };
};

function isPassed(obtainedMarks, passMarks) {
    return parseFloat(obtainedMarks) >= parseFloat(passMarks);
};

module.exports = { calculateGrade, isPassed};