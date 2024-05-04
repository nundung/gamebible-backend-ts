import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import BadRequestException from '../exception/badRequestException';

dotenv.config();

const checkLogin = (req, res, next) => {
    // `Authorization` 헤더에서 값을 추출
    const authHeader: string = req.headers.authorization;

    try {
        if (!authHeader) {
            throw new BadRequestException('no token');
        }

        // `Bearer ` 접두사를 제거하여 실제 토큰 값만 추출
        const token = authHeader.split(' ')[1];

        if (!token) {
            throw new BadRequestException('no token');
        }

        req.decoded = jwt.verify(token, process.env.SECRET_KEY);
        next();
    } catch (err) {
        const statusCode: number = err.status || 500;
        console.log(err.stack);
        res.status(statusCode).send(err.message);
    }
};

export default checkLogin;
