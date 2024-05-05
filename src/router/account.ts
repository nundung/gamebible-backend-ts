import { Router, Request, Response, NextFunction } from 'express';
import { body, query } from 'express-validator';
import { handleValidationErrors } from '../middleware/validator';
import NotFoundException from '../exception/notFoundException';
import ConflictException from '../exception/conflictException';
import hashPassword from '../module/hashPassword';
import { PoolClient, PoolConfig } from 'pg';
import pool from '../config/postgres';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import InternalServerException from '../exception/internalServerException';
import generateVerificationCode from '../module/generateVerificationCode';
import sendVerificationEmail from '../module/sendVerificationEmail';
import deleteCode from '../module/deleteEmail';
import ForbiddenException from '../exception/forbiddenException';
import changePwEmail from '../module/sendChangePwEmail';
import checkLogin from '../middleware/checkLogin';
import BadRequestException from '../exception/badRequestException';
import UnauthorizedException from '../exception/unauthorizedException';

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
                    idx: user.userIdx,
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

//회원가입
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
                idx: string;
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
                idx: number;
            }>(
                `SELECT
                    idx
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
                    idx
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
                RETURNING 
                    idx`,
                [nickname, email, isAdmin]
            );
            if (userRows.length === 0) {
                await poolClient.query('ROLLBACK');
                console.log('트랜젝션');
                throw new InternalServerException('회원가입 실패');
            }

            const userIdx = userRows[0].idx;
            const { rows: accountRows } = await poolClient.query<{
                userIdx: number;
            }>(
                `INSERT INTO
                    account_local (
                        user_idx,
                        id,
                        pw
                        )
                VALUES ($1, $2, $3)
                RETURNING 
                    user_idx AS userIdx`,
                [userIdx, id, hashedPw]
            );
            if (accountRows.length === 0) {
                await poolClient.query('ROLLBACK');
                console.log('트랜젝션');
                throw new InternalServerException('회원가입 실패');
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
        } catch (err) {
            next(err);
        }
    }
);

//닉네임 중복 확인
router.post(
    '/nickname/check',
    body('nickname')
        .trim()
        .isLength({ min: 2, max: 20 })
        .withMessage('닉네임은 2자 이상 20자 이하로 해주세요.'),
    handleValidationErrors,
    async (req, res, next) => {
        try {
            const nickname: string = req.body.nickname;

            const { rows: nicknameRows } = await pool.query<{
                userIdx: string;
            }>(
                `SELECT
                    * 
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
            return res.status(200).send('사용 가능한 닉네임입니다.');
        } catch (err) {
            next(err);
        }
    }
);

//이메일 중복 확인/인증
router.post(
    '/email/check',
    body('email').trim().isEmail().withMessage('유효하지 않은 이메일 형식입니다.'),
    handleValidationErrors,
    async (req, res, next) => {
        try {
            const email: string = req.body.email;
            const { rows: emailRows } = await pool.query<{
                idx: number;
            }>(
                `SELECT
                    idx
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
            } else {
                const verificationCode = generateVerificationCode();
                const { rows: codeRows } = await pool.query<{
                    idx: number;
                }>(
                    `INSERT INTO
                        email_verification (
                            email,
                            code
                            )
                    VALUES
                        ($1, $2)
                    RETURNING 
                        idx`,
                    [email, verificationCode]
                );
                if (codeRows.length == 0) {
                    throw new InternalServerException('회원가입 실패');
                }
                await sendVerificationEmail(email, verificationCode);
                await deleteCode(pool);
                return res.status(200).send('인증 코드가 발송되었습니다.');
            }
        } catch (e) {
            next(e);
        }
    }
);

//이메일 인증 확인
router.post(
    '/email/auth',
    body('code')
        .trim()
        .isLength({ min: 5, max: 5 })
        .withMessage('인증코드는 5자리 숫자로 해주세요.')
        .isNumeric()
        .withMessage('인증코드는 숫자로만 구성되어야 합니다.'),
    body('email').trim().isEmail().withMessage('유효하지 않은 이메일 형식입니다.'),
    handleValidationErrors,
    async (req, res, next) => {
        try {
            const { email, code } = req.body as {
                email: string;
                code: string;
            };
            const { rows: authRows } = await pool.query<{
                idx: number;
            }>(
                `SELECT
                    idx
                FROM
                    email_verification
                WHERE
                    email = $1
                AND
                    code = $2`,
                [email, code]
            );
            if (authRows.length == 0) {
                throw new ForbiddenException('잘못된 인증 코드입니다.');
            }
            return res.status(200).send('이메일 인증이 완료되었습니다.');
        } catch (e) {
            next(e);
        }
    }
);

//아이디 찾기
router.get(
    '/id',
    query('email').trim().isEmail().withMessage('유효하지 않은 이메일 형식입니다.'),
    handleValidationErrors,
    async (req, res, next) => {
        const email: string = req.query.email;
        try {
            const { rows: idRows } = await pool.query<{
                id: string;
            }>(
                `SELECT
                    al.id
                FROM
                    account_local al
                JOIN
                    "user" u
                ON
                    al.user_idx = u.idx
                WHERE
                    u.email = $1
                AND
                    u.deleted_at IS NULL`,
                [email]
            );
            if (idRows.length === 0) {
                throw new NotFoundException('일치하는 사용자가 없습니다.');
            }
            const foundId = idRows[0].id;
            return res.status(200).send({ id: foundId });
        } catch (err) {
            next(err);
        }
    }
);

//비밀번호 찾기(이메일 전송)
router.post(
    '/pw/email',
    body('email').trim().isEmail().withMessage('유효하지 않은 이메일 형식입니다.'),
    handleValidationErrors,
    async (req, res, next) => {
        const email: string = req.body.email;
        try {
            const emailToken = await changePwEmail(email);
            return res.status(200).send({ token: emailToken });
        } catch (err) {
            next(err);
        }
    }
);

//비밀번호 변경
router.put(
    '/pw',
    body('pw')
        .trim()
        .isLength({ min: 8, max: 20 })
        .withMessage('비밀번호는 8자 이상 20자 이하이어야 합니다.'),
    handleValidationErrors,
    checkLogin,
    async (req, res, next) => {
        const pw: string = req.body.pw;
        try {
            const userIdx: number = req.decoded.idx;
            if (!userIdx) {
                throw new UnauthorizedException('로그인 정보 없음');
            }
            const hashedPw = await hashPassword(pw); // 비밀번호 해싱
            const { rows: deletePwRows } = await pool.query<{
                pw: string;
            }>(
                `UPDATE
                    account_local
                SET
                    pw = $2
                WHERE
                    user_idx = $1
                RETURNING
                    pw`,
                [userIdx, hashedPw]
            );
            if (deletePwRows.length === 0) {
                throw new BadRequestException('비밀번호 변경 실패');
            }
            return res.status(200).send('비밀번호 변경 성공');
        } catch (err) {
            next(err);
        }
    }
);

// 내 정보 보기
router.get('/info', checkLogin, async (req, res, next) => {
    try {
        const userIdx: number = req.decoded.userIdx;
        if (!userIdx) {
            throw new UnauthorizedException('로그인 정보 없음');
        }
        const { rows: userInfoRows } = await pool.query(
            `SELECT
                u.*, al.*, ak.*
            FROM
                "user" u
            LEFT JOIN
                account_local al ON u.idx = al.user_idx
            LEFT JOIN
                account_kakao ak ON u.idx = ak.user_idx
            WHERE
                u.idx = $1`,
            [userIdx]
        );
        if (userInfoRows.length === 0) {
            throw new ForbiddenException('내 정보 보기 실패');
        }

        // 첫 번째 조회 결과 가져오기
        const user = userInfoRows[0];
        // 응답 전송
        res.status(200).send({ data: user });
    } catch (err) {
        next(err);
    }
});

export default router;
