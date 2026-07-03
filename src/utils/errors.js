class FileValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'FileValidationError';
        this.statusCode = 400;
        this.errorCode = 'FILE_VALIDATION_FAILED';
    }
}

class RowValidationError extends Error {
    constructor(message, details = null, errorReportUrl = null) {
        super(message);
        this.name = 'RowValidationError';
        this.statusCode = 400;
        this.errorCode = 'ROW_VALIDATION_FAILED';
        this.details = details;
        this.errorReportUrl = errorReportUrl;
    }
}

class DatabaseError extends Error {
    constructor(message, originalError = null) {
        super(message);
        this.name = 'DatabaseError';
        this.statusCode = 500;
        this.errorCode = 'DATABASE_ERROR';
        this.originalError = originalError;
    }
}

class ForeignKeyError extends Error {
    constructor(message, details = null) {
        super(message);
        this.name = 'ForeignKeyError';
        this.statusCode = 400;
        this.errorCode = 'FOREIGN_KEY_ERROR';
        this.details = details;
    }
}

module.exports = {
    FileValidationError,
    RowValidationError,
    DatabaseError,
    ForeignKeyError
};
