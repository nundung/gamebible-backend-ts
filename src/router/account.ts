import { Router, Request, Response, NextFunction } from 'express';
import { body } from 'express-validator';
import { handleValidationErrors } from '../middleware/validator';
import NotFoundException from '../exception/notFoundException';
import ConflictException from '../exception/conflictException';
import hashPassword from '../module/hashPassword';
import { PoolClient, PoolConfig } from 'pg';
import pool from '../config/postgres';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import InternalServerException from '../exception/internalServerException';

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
                    "user" u 
                ON 
                    al.user_idx = u.idx
                WHERE
                    al.id = $1 AND u.deleted_at IS NULL`,
                [id]
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

// 회원가입
router.post(
    '/',
    body('id')
        .trim()
        .isLength({ min: 4, max: 20 })
        .withMessage('아이디는 4자 이상 20자 이하로 해주세요.'),
    body('pw')
        .trim()
        .isLength({ min: 8, max: 20 })
        .withMessage('비밀번호는 8자 이상 20자 이하이어야 합니다.'),
    body('email').trim().isEmail().withMessage('유효하지 않은 이메일 형식입니다.'),
    body('nickname')
        .trim()
        .isLength({ min: 2, max: 20 })
        .withMessage('닉네임은 2자 이상 20자 이하로 해주세요.'),
    handleValidationErrors,
    async (req, res, next) => {
        const { id, pw, nickname, email } = req.body as {
            id: string;
            pw: string;
            nickname: string;
            email: string;
        };
        const isAdmin: boolean = false;
        let poolClient: PoolClient | null;
        try {
            poolClient = await pool.connect();
            await poolClient.query('BEGIN');

            //아이디 중복 확인
            const { rows: idRows } = await poolClient.query<{
                userIdx: string;
            }>(
                `SELECT
                    al.user_idx AS "userIdx"
                FROM
                    account_local al
                JOIN
                    "user" u
                ON
                    al.user_idx = u.idx
                WHERE
                    al.id = $1
                AND
                    u.deleted_at IS NULL`,
                [id]
            );
            if (idRows.length > 0) {
                throw new ConflictException('아이디가 이미 존재합니다.');
            }

            //닉네임 중복 확인
            const { rows: nicknameRows } = await poolClient.query<{
                userIdx: number;
            }>(
                `SELECT
                    user_idx AS "userIdx"
                FROM
                    "user"
                WHERE 
                    nickname = $1
                AND 
                    deleted_at IS NULL`,
                [nickname]
            );
            if (nicknameRows.length > 0) {
                throw new ConflictException('닉네임이 이미 존재합니다.');
            }

            //이메일 중복 확인
            const { rows: emailRows } = await poolClient.query<{
                userIdx: number;
            }>(
                `SELECT 
                    user_idx AS "userIdx"
                FROM
                    "user" 
                WHERE 
                    email = $1 
                AND 
                    deleted_at IS NULL`,
                [email]
            );
            if (emailRows.length > 0) {
                throw new ConflictException('이메일이 이미 존재합니다.');
            }

            const hashedPw = await hashPassword(pw); // 비밀번호 해싱
            const { rows: userRows } = await poolClient.query<{
                idx: number;
            }>(
                `INSERT INTO
                    "user"(
                        nickname,
                        email,
                        is_admin
                        ) 
                VALUES ($1, $2, $3)
                RETURNING idx`,
                [nickname, email, isAdmin]
            );
            if (userRows.length === 0) {
                await poolClient.query('ROLLBACK');
                console.log('트랜젝션');
                // throw new InternalServerException('회원가입 실패');
                return res.status(204).send({ message: '회원가입 실패' });
            }

            const userIdx = userRows[0].idx;
            const { rows: accountRows } = await poolClient.query(
                `INSERT INTO
                    account_local (
                        user_idx,
                        id,
                        pw
                        )
                VALUES ($1, $2, $3)
                RETURNING *`,
                [userIdx, id, hashedPw]
            );

            if (accountRows.length === 0) {
                await poolClient.query('ROLLBACK');
                console.log('트랜젝션');
                // throw new InternalServerException('회원가입 실패');
                return res.status(204).send({ message: '회원가입 실패' });
            }
            await poolClient.query('COMMIT');
            return res.status(200).send('회원가입 성공');
        } catch (err) {
            await poolClient.query('ROLLBACK');
            next(err);
        } finally {
            if (poolClient) poolClient.release();
        }
    }
);

//아이디 중복 확인
router.post(
    '/id/check',
    body('id')
        .trim()
        .isLength({ min: 4, max: 20 })
        .withMessage('아이디는 4자 이상 20자 이하로 해주세요.'),
    handleValidationErrors,
    async (req, res, next) => {
        try {
            const id: string = req.body.id;
            const { rows: idRows } = await pool.query<{
                userIdx: number;
            }>(
                `SELECT
                    al.user_idx
                FROM
                    account_local al
                JOIN
                    "user" u
                ON
                    al.user_idx = u.idx
                WHERE
                    al.id = $1
                AND 
                    u.deleted_at IS NULL
                `,
                [id]
            );
            if (idRows.length > 0) {
                throw new ConflictException('아이디가 이미 존재합니다.');
            }
            return res.status(200).send('사용 가능한 아이디입니다.');
        } catch (e) {
            next(e);
        }
    }
);

export default router;
