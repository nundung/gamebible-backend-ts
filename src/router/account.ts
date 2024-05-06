import { Router } from 'express';
import { body, query } from 'express-validator';
import handleValidationError from '../middleware/validator';
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
import uploadS3 from '../middleware/upload';
import axios from 'axios';

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
    handleValidationError,
    async (req, res, next) => {
        const { id, pw } = req.body as { id: string; pw: string };
        try {
            const { rows: userRows } = await pool.query<{
                pw: string;
                idx: number;
                isAdmin: boolean;
            }>(
                `
                SELECT
                    pw,
                    user_idx AS "idx",
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
                    idx: user.idx,
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
    handleValidationError,
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
    handleValidationError,
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
    handleValidationError,
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
    handleValidationError,
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
    handleValidationError,
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
    handleValidationError,
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
    handleValidationError,
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
    handleValidationError,
    checkLogin,
    async (req, res, next) => {
        const pw: string = req.body.pw;
        try {
            const loginUser = req.decoded;
            if (!loginUser.idx) {
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
                [loginUser.idx, hashedPw]
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
        const loginUser = req.decoded;
        if (!loginUser.idx) {
            throw new UnauthorizedException('로그인 정보 없음');
        }
        const { rows: userInfoRows } = await pool.query<{
            idx: number;
            isAdmin: boolean;
            id: string;
            nickname: string;
            email: string;
            created_at: Date;
            deleted_at: Date;
            kakaoKey: number;
        }>(
            `SELECT
                u.idx,
                u.is_admin AS "isAdmin",
                u.nickname,
                u.email,
                u.created_at,
                u.deleted_at,
                al.user_idx,
                al.id,
                ak.kakao_key AS "kakaoKey"
            FROM
                "user" u
            LEFT JOIN
                account_local al 
            ON 
                u.idx = al.user_idx
            LEFT JOIN
                account_kakao ak
            ON 
                u.idx = ak.user_idx
            WHERE
                u.idx = $1`,
            [loginUser.idx]
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

// 내 정보 수정
router.put(
    '/info',
    checkLogin,
    body('email').trim().isEmail().withMessage('유효하지 않은 이메일 형식입니다.'),
    body('nickname')
        .trim()
        .isLength({ min: 2, max: 20 })
        .withMessage('닉네임은 2자 이상 20자 이하로 해주세요.'),
    handleValidationError,
    async (req, res, next) => {
        const loginUser = req.decoded;
        const { nickname, email } = req.body as {
            nickname: string;
            email: string;
        };
        try {
            //저장된 정보 불러오기
            const { rows: userInfoRows } = await pool.query<{
                userNickname: string;
                userEmail: string;
            }>(
                `SELECT
                    nickname AS "userNickname",
                    email AS "userEmail"
                FROM
                    "user"
                WHERE
                    idx = $1
                AND
                    deleted_at IS NULL`,
                [loginUser.idx]
            );
            if (userInfoRows.length === 0) {
                throw new NotFoundException('사용자 정보 조회 실패');
            }
            //닉네임 중복 확인
            const { userNickname, userEmail } = userInfoRows[0];
            const { rows: nicknameRows } = await pool.query<{
                idx: string;
            }>(
                `SELECT
                    idx
                FROM
                    "user" 
                WHERE 
                    nickname = $1
                AND 
                    nickname <> $2 
                AND
                    deleted_at IS NULL`,
                [nickname, userNickname]
            );
            if (nicknameRows.length > 0) {
                throw new ConflictException('닉네임이 이미 존재합니다.');
            }

            //이메일 중복 확인
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
                    email <> $2
                AND
                    deleted_at IS NULL`,
                [email, userEmail]
            );
            if (emailRows.length > 0) {
                throw new ConflictException('이메일이 이미 존재합니다.');
            }

            const { rows: userInfoChangeRows } = await pool.query<{
                idx: number;
            }>(
                `UPDATE
                    "user"
                SET
                    nickname = $2,
                    email = $3
                WHERE
                    idx = $1
                RETURNING
                    idx`,
                [loginUser.idx, nickname, email]
            );
            if (userInfoChangeRows.length === 0) {
                throw new ForbiddenException('내 정보 수정 실패');
            }
            return res.status(200).send({ message: '내 정보 수정 성공' });
        } catch (err) {
            next(err);
        }
    }
);

//프로필 이미지 업로드
router.put('/image', checkLogin, uploadS3.single('image'), async (req, res, next) => {
    let poolClient: PoolClient;
    try {
        const loginUser = req.decoded;
        const uploadedFile = req.file;

        poolClient = await pool.connect();
        await poolClient.query('BEGIN');

        if (!uploadedFile) {
            throw new BadRequestException('업로드 된 파일이 없습니다');
        }
        //기존 프로필 이미지가 있는지 확인
        const { rows: searchImageRows } = await pool.query(
            `SELECT
                *
            FROM
                profile_img
            WHERE
                user_idx = $1`,
            [loginUser.idx]
        );

        //기존 프로필 이미지가 있는 경우 삭제
        if (searchImageRows.length > 0) {
            await poolClient.query(
                `UPDATE
                    profile_img
                SET
                    deleted_at = now()
                WHERE
                    user_idx = $1`,
                [loginUser.idx]
            );
            console.log('이전 이미지 삭제');
        }

        //새 프로필 이미지 업로드
        const { rows: imageRows } = await poolClient.query<{
            idx: number;
        }>(
            `INSERT INTO
                profile_img (
                    img_path,
                    user_idx
                )
            VALUES ($1, $2)
            RETURNING
                idx`,
            [uploadedFile.destination, loginUser.idx]
        );
        if (imageRows.length === 0) {
            await poolClient.query(`ROLLBACK`);
            throw new ForbiddenException('프로필 이미지 수정 실패');
        }
        await poolClient.query(`COMMIT`);
        return res.status(200).send('프로필 이미지 수정 성공');
    } catch (err) {
        if (poolClient) await poolClient.query(`ROLLBACK`);
        next(err);
    } finally {
        if (poolClient) poolClient.release();
    }
});

// 회원 탈퇴
router.delete('/', checkLogin, async (req, res, next) => {
    try {
        const loginUser = req.decoded;
        await pool.query(
            `UPDATE
                "user" 
            SET
                deleted_at = now()
            WHERE
                idx = $1`,
            [loginUser.idx]
        );
        return res.status(200).send('회원 탈퇴 성공');
    } catch (err) {
        next(err);
    }
});

//알람 출력
router.get('/notification', checkLogin, async (req, res, next) => {
    try {
        const loginUser = req.decoded;
        const { rows: firstLastIdxRows } = await pool.query<{
            idx: number;
        }>(
            `SELECT
                idx
            FROM
                notification
            WHERE
                user_idx=$1
            ORDER BY
                idx
            DESC LIMIT 1`,
            [loginUser.idx]
        );
        if (firstLastIdxRows.length === 0) {
            return res.status(204).send(loginUser.idx + '번 사용자의 알람이 없습니다.');
        }
        const returnfirstLastIdx = firstLastIdxRows[0].idx;
        const lastIdx = req.query.lastidx || returnfirstLastIdx + 1;

        // 사용자의 알람 조회
        const { rows: notificationRows } = await pool.query(
            `SELECT
                n.*,
                p.title AS post_title,
                g.title AS game_title
            FROM
                notification n
            LEFT JOIN
                post p ON n.post_idx = p.idx AND n.type = 1
            LEFT JOIN
                game g ON n.game_idx = g.idx AND (n.type = 2 OR n.type = 3)
            WHERE
                n.user_idx = $1
            AND
                n.idx < $2
            AND 
                n.deleted_at IS NULL
            ORDER BY
                n.idx DESC
            LIMIT 20`,
            [lastIdx]
        );
        const list = notificationRows;
        const returnLastIdx = list[list.length - 1]?.idx;
        if (notificationRows.length === 0) {
            return res.status(204).send(loginUser.idx + '번 사용자의 알람이 없습니다.');
        }
        res.status(200).send({ notifications: notificationRows, lastIdx: returnLastIdx });
    } catch (err) {
        next(err);
    }
});

//알람 삭제
router.delete('/notification/:notificationId', checkLogin, async (req, res, next) => {
    try {
        const loginUser = req.decoded; // 사용자 ID
        const { notificationId } = req.params; // URL에서 알람 ID 추출

        // 알람이 사용자의 것인지 확인하는 쿼리
        const { rows: checkRows } = await pool.query(
            `SELECT
                user_idx AS "userIdx'
            FROM
                notification
            WHERE
                idx = $1 AND user_idx = $2`,
            [notificationId, loginUser.idx]
        );
        if (checkRows.length === 0) {
            throw new ForbiddenException('해당 알람을 찾을 수 없거나 삭제할 권한이 없습니다.');
        }

        // 알람 삭제 쿼리 실행
        await pool.query(
            `UPDATE
                notification
            SET
                deleted_at = now()
            WHERE
                idx = $1`,
            [notificationId]
        );
        res.status(200).send(notificationId + '번 알람이 삭제되었습니다.');
    } catch (err) {
        next(err);
    }
});

//카카오 로그인(회원가입)경로
router.get('/auth/kakao', (req, res, next) => {
    const kakao = process.env.KAKAO_LOGIN_AUTH;
    res.status(200).send({ data: kakao });
});

//카카오 로그인(회원가입)
router.get('/kakao/callback', async (req, res, next) => {
    const { code } = req.query;
    const tokenRequestData = {
        grant_type: 'authorization_code',
        client_id: process.env.REST_API_KEY,
        redirect_uri: process.env.REDIRECT_URI,
        code,
    };
    let poolClient: PoolClient;
    try {
        const params = new URLSearchParams();
        Object.keys(tokenRequestData).forEach((key) => {
            params.append(key, tokenRequestData[key]);
        });

        // Axios POST 요청
        const { data } = await axios.post(
            'https://kauth.kakao.com/oauth/token',
            params.toString(), // URLSearchParams 객체를 문자열로 변환
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        const ACCESS_TOKEN = data.access_token;
        console.log(ACCESS_TOKEN);
        const config = { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } };
        const response = await axios.get('https://kapi.kakao.com/v2/user/me', config);

        poolClient = await pool.connect();
        await poolClient.query('BEGIN');

        //중복 사용자 조회
        const kakaoSql = `
            SELECT
                *
            FROM
                account_kakao ak
            JOIN
                "user" u ON ak.user_idx = u.idx
            WHERE
                ak.kakao_key = $1 AND u.deleted_at IS NULL`;
        const { rows: kakaoRows } = await poolClient.query(kakaoSql, [response.data.id]);

        //중복 사용자가 없다면 회원가입
        if (kakaoRows.length === 0) {
            //이메일 중복 확인
            const { rows: emailRows } = await poolClient.query<{
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
                [response.data.kakao_account.email]
            );
            if (emailRows.length > 0) {
                await poolClient.query('ROLLBACK');
                throw new ConflictException('일반 회원가입으로 가입된 사용자입니다.');
            }

            //랜덤 닉네임 생성
            function generateRandomString(length: number) {
                let result = '';
                let characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                let charactersLength = characters.length;
                for (let i = 0; i < length; i++) {
                    result += characters.charAt(Math.floor(Math.random() * charactersLength));
                }
                return result;
            }
            let randomNickname = generateRandomString(20);
            //닉네임 중복 확인
            const checkNicknameSql = `
                SELECT
                    idx
                FROM
                    "user" 
                WHERE 
                    nickname = $1 
                AND 
                    deleted_at IS NULL`;
            const value = [randomNickname];
            let { rows: nicknameRows } = await poolClient.query<{ idx: number }>(
                checkNicknameSql,
                value
            );
            if (nicknameRows.length > 0) {
                while (nicknameRows.length > 0) {
                    randomNickname = generateRandomString(20);
                    nicknameRows = await poolClient.query<{ idx: number }>(checkNicknameSql, value);
                }
            }

            //user테이블에 정보 추가
            const { rows: kakaoRows } = await poolClient.query<{ idx: number }>(
                `INSERT INTO
                    "user"(
                        nickname,
                        email,
                        is_admin
                    ) 
                VALUES ($1, $2, $3)
                RETURNING 
                    idx`,
                [randomNickname, response.data.kakao_account.email, false]
            );
            if (kakaoRows.length === 0) {
                await poolClient.query('ROLLBACK');
                throw new ForbiddenException('카카오 회원가입 실패');
            }

            //kakao테이블에 정보 추가
            const userIdx = kakaoRows[0].idx;
            const { rows: accountRows } = await poolClient.query<{ idx: number }>(
                `INSERT INTO
                    account_kakao (
                        user_idx, 
                        kakao_key
                        )
                VALUES ($1, $2)
                RETURNING 
                    idx`,
                [userIdx, response.data.id]
            );
            if (accountRows.length === 0) {
                await poolClient.query('ROLLBACK');
                throw new ForbiddenException('카카오 회원가입 실패');
            }
        }

        const { rows: userRows } = await poolClient.query(kakaoSql, [response.data.id]);

        if (userRows.length === 0) {
            throw new ForbiddenException('카카오 회원가입 실패');
        }

        const user = userRows[0];

        await poolClient.query('COMMIT');

        const token = jwt.sign(
            {
                id: response.data.id,
                userIdx: user.user_idx,
                isAdmin: user.is_admin,
            },
            process.env.SECRET_KEY,
            {
                expiresIn: '5h',
            }
        );
        return res.status(200).json({
            kakaoLogin: true,
            idx: user.user_idx,
            id: response.data.id,
            email: response.data.kakao_account.email,
            token: token,
        });
    } catch (err) {
        next(err);
    }
});

//카카오 탈퇴
router.delete('/auth/kakao', checkLogin, async (req, res, next) => {
    const loginUser = req.decoded;
    try {
        await axios.post(
            'https://kapi.kakao.com/v1/user/unlink',
            `target_id_type=user_id&target_id=${loginUser.id}`,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Authorization: `KakaoAK ${process.env.ADMIN_KEY}`,
                },
            }
        );

        const { rowCount: deleteRowCount } = await pool.query(
            `UPDATE
                "user"
            SET
                deleted_at = now()
            WHERE
                idx = $1`,
            [loginUser.idx]
        );
        if (deleteRowCount === 0) {
            throw new ForbiddenException('카카오 회원탈퇴 실패');
        }
        res.json('회원 탈퇴 성공');
    } catch (error) {
        next(error);
    }
});

export default router;
