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
        const authArray = authHeader.split(' ');
        const jwtPayload = jwt.verify(authArray[1], process.env.SECRET_KEY);
        if (typeof jwtPayload == 'string') throw new UnauthorizedException('no token');
        req.decoded = {
            idx: jwtPayload.userIdx,
            id: jwtPayload.id,
            isAdmin: jwtPayload.isAdmin,
        };
        const isAdmin = req.decoded.isAdmin;
        if (!isAdmin) {
            throw new ForbiddenException('no admin');
        }
        next();
    } catch (err) {
        next(err);
    }
};

export default checkAdmin;
