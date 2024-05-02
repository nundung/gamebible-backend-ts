import { Router, Request, Response, NextFunction } from 'express';
import { body } from 'express-validator';
import { handleValidationErrors } from '../middleware/validator';
import NotFoundException from '../exception/notFoundException';
import jwt from 'jsonwebtoken';
import pool from '../config/postges';
import bcrypt from 'bcrypt';

require('dotenv').config();
const router = Router();

//로그인
router.post(
    '/auth',
    body('id')
        .trim()
        .isLength({ min: 4, max: 20 })
        .isString()
        .withMessage('아이디는 4자 이상 20자 이하로 해주세요.'),
    body('pw')
        .trim()
        .isLength({ min: 8, max: 20 })
        .withMessage('비밀번호는 8자 이상 20자 이하이어야 합니다.'),
    handleValidationErrors,
    async (req, res, next) => {
        const { id, pw } = req.body as { id: string; pw: string };
        try {
            // 사용자 정보 조회 (비밀번호는 해시된 상태로 저장되어 있음)
            const values = [id];
            // 제네릭: 타입을 동적으로 할당함. 그런 제네릭을 써야할 때가 있음
            const { rows: userRows } = await pool.query<{
                pw: string;
                userIdx: number;
                isAdmin: boolean;
            }>(
                `
                SELECT
                    pw,
                    user_idx AS "userIdx",
                    is_admin AS "isAdmin"
                FROM
                    account_local al
                JOIN
                    "user" u ON al.user_idx = u.idx
                WHERE
                    al.id = $1 AND u.deleted_at IS NULL`,
                values
            );
            const user = userRows[0];

            if (!user) {
                throw new NotFoundException('해당 id로 가입된 사용자 존재하지 않음');
            }
            // bcrypt.compare 함수로 비밀번호 비교
            const match = await bcrypt.compare(pw, user.pw);

            if (!match) {
                throw new NotFoundException('비밀번호 일치하지 않음');
            }

            // 비밀번호가 일치하면 토큰 생성
            const token = jwt.sign(
                {
                    userIdx: user.userIdx,
                    isAdmin: user.isAdmin,
                },
                process.env.SECRET_KEY || '',
                {
                    expiresIn: '5h',
                }
            );
            res.status(200).send({ kakaoLogin: false, token: token, data: user });
        } catch (e) {
            next(e);
        }
    }
);

export default router;
