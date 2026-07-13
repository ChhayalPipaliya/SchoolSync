const { FileValidationError } = require('../../utils/errors');

exports.downloadTemplate = async (req, res, next) => {
    try {
        const { entityType } = req.params;
        let csvContent = "";
        let filename = "";
        switch (entityType) {
            case 'students':
                filename = "students_import_template.csv";
                csvContent =
                    `Name,Email,Roll No,Class ID,Section ID,Medium,Parent Name,Parent Phone,Address,Date of Birth,Gender,Admission Date
                        John Doe,john@example.com,101,Std 10,A,English,Robert Doe,9876543210,123 Main St,2010-05-15,Male,2024-04-01
                        Jane Smith,jane@example.com,102,Std 10,A,English,Mary Smith,9876543211,456 Oak Rd,2010-08-22,Female,2024-04-01
                    `;
                break;
            case 'teachers':
                filename = "teachers_import_template.csv";
                csvContent =
                    `Name,Email,Phone,Qualification,Joining Date,Salary,Subjects
                        Alice Johnson,alice@example.com,9876543220,M.Sc. B.Ed,2020-06-01,45000,"Math, Physics"
                        Bob Miller,bob@example.com,9876543221,MA English,2021-08-15,40000,English
                    `;
                break;
            case 'books':
                filename = "books_import_template.csv";
                csvContent =
                    `Title,Author,ISBN,Category ID,Rack ID,Quantity,Publisher,Published Year
                        The Great Gatsby,F. Scott Fitzgerald,9780743273565,1,2,5,Scribner,1925
                        To Kill a Mockingbird,Harper Lee,9780061120084,2,2,3,Harper Perennial,1960
                    `;
                break;
            case 'fees':
                filename = "fees_import_template.csv";
                csvContent =
                    `Class ID,Fee Type,Amount,Due Date,Description
                        1,Tuition,2500,2024-05-10,First Term Tuition Fee
                        1,Exam,500,2024-06-15,Final Exam Fee
                    `;
                break;
            case 'marks':
                filename = "marks_import_template.csv";
                csvContent =
                    `Exam ID,Student ID,Subject ID,Marks Obtained,Grade,Remarks
                        1,1,2,85,A,Excellent performance
                        1,2,2,72,B,Good job
                    `;
                break;
            default:
            return res.status(400).json({ success: false, message: 'Invalid entity type for template' });
        };
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.status(200).send(csvContent);
    } catch (err) {
        next(err);
    };
};
