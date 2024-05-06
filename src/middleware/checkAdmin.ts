import { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import ForbiddenException from '../exception/forbiddenException';
import UnauthorizedException from '../exception/unauthorizedException';

require('dotenv').config();

const checkAdmin: RequestHandler = (req, res, next) => {
    // `Authorization` 헤더에서 값을 추출
    const authHeader: string = req.headers.authorization;

    try {
        if (!authHeader) {
            throw new UnauthorizedException('no token');
        }
        req.decoded = jwt.verify(authHeader, process.env.SECRET_KEY) as {
            idx: number;
            id: string;
            isAdmin: boolean;
        };
        const isAdmin = req.decoded.isAdmin;
        if (isAdmin != true) {
            throw new ForbiddenException('no admin');
        }
        next();
    } catch (err) {
        next(err);
    }
};

module.exports = checkAdmin;
