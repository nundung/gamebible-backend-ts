import { Request, Response, NextFunction, RequestHandler } from 'express';
import { validationResult } from 'express-validator';

const handleValidationErrors: RequestHandler = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

export default handleValidationErrors;
