import { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import BadRequestException from '../exception/badRequestException';
import UnauthorizedException from '../exception/unauthorizedException';

dotenv.config();

const checkLogin: RequestHandler = (req, res, next) => {
    // `Authorization` 헤더에서 값을 추출
    const authHeader: string = req.headers.authorization;

    try {
        if (!authHeader) {
            throw new UnauthorizedException('no token');
        }
        const authArray = authHeader.split(' ');

        // 배열의 첫 번째 요소가 'Bearer'인지 확인
        if (authArray.length !== 2 || authArray[0] !== 'Bearer') {
            // 올바른 형식이 아니면 에러 처리
            throw new BadRequestException('올바른 인증 형식이 아닙니다.');
        }
        const jwtPayload = jwt.verify(authArray[1], process.env.SECRET_KEY!);
        if (typeof jwtPayload == 'string') throw new UnauthorizedException('no token');
        req.decoded = {
            id: jwtPayload.id,
            idx: jwtPayload.idx,
            isAdmin: jwtPayload.isAdmin,
        };
        // // Bearer 토큰이 맞으면 두 번째 요소를 추출하여 토큰으로 사용

        next();
    } catch (err) {
        const statusCode: number = err.status || 500;
        console.log(err.stack);
        res.status(statusCode).send(err.message);
    }
};

export default checkLogin;
