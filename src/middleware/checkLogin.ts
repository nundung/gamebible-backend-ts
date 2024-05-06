import { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import BadRequestException from '../exception/badRequestException';

dotenv.config();

const checkLogin: RequestHandler = (req, res, next) => {
    // `Authorization` 헤더에서 값을 추출
    const authHeader: string = req.headers.authorization;

    try {
        if (!authHeader) {
            throw new BadRequestException('no token');
        }
        const authArray = authHeader.split(' ');

        // 배열의 첫 번째 요소가 'Bearer'인지 확인
        if (authArray.length !== 2 || authArray[0] !== 'Bearer') {
            // 올바른 형식이 아니면 에러 처리
            throw new BadRequestException('올바른 인증 형식이 아닙니다.');
        }

        // Bearer 토큰이 맞으면 두 번째 요소를 추출하여 토큰으로 사용
        const token = authArray[1];
        req.decoded = jwt.verify(token, process.env.SECRET_KEY) as {
            idx: number;
            id: string;
            isAdmin: boolean;
        };
        next();
    } catch (err) {
        const statusCode: number = err.status || 500;
        console.log(err.stack);
        res.status(statusCode).send(err.message);
    }
};

export default checkLogin;
