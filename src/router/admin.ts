import { Router } from 'express';
import { PoolClient, PoolConfig } from 'pg';

import pool from '../config/postgres';
import uploadS3 from '../middleware/upload';
import checkLogin from '../middleware/checkLogin';
import checkAdmin from '../middleware/checkAdmin';
import BadRequestException from '../exception/badRequestException';
import ConflictException from '../exception/conflictException';

require('dotenv').config();
const router = Router();

// 게임 생성 요청 승인
router.post(
    '/game',
    checkLogin,
    checkAdmin,
    uploadS3.fields([
        { name: 'thumbnail', maxCount: 1 },
        { name: 'banner', maxCount: 1 },
    ]),
    async (req, res, next) => {
        const loginUser = req.decoded;
        const { requestIdx, title, titleKor, titleEng } = req.body as {
            requestIdx: number;
            title: string;
            titleKor: string;
            titleEng: string;
        };
        const { thumbnail, banner } = req.files as { [fieldname: string]: Express.MulterS3.File[] };
        let poolClient: PoolClient | null = null;

        try {
            if (!thumbnail || !banner) return res.status(400).send({ message: '이미지 없음' });

            poolClient = await pool.connect();

            //요청삭제, 제목,유저idx반환
            const { rows: deleteRequestRows } = await poolClient.query<{
                userIdx: number;
                title: string;
            }>(
                `UPDATE
                    request
                SET 
                    deleted_at = now(), is_confirmed = true
                WHERE 
                    idx = $1
                RETURNING
                    user_idx AS "userIdx",
                    title`,
                [requestIdx]
            );
            const request = deleteRequestRows[0];

            //트랜잭션 시작
            await poolClient.query('BEGIN');

            //기존 게임중복확인(영어)
            const { rows: getGameWithTitleEngRows } = await poolClient.query<{
                idx: number;
            }>(
                `SELECT
                    idx
                FROM
                    game
                WHERE
                    title_eng = $1
                AND
                    deleted_at IS NULL`,
                [titleEng]
            );

            //기존 게임중복확인(한글)
            const { rows: getGameWithTitleKorRows } = await poolClient.query<{
                idx: number;
            }>(
                `SELECT
                    idx
                FROM
                    game
                WHERE
                    title_kor = $1
                AND
                    deleted_at IS NULL`,
                [titleKor]
            );

            const existingGameWithTitleEng = getGameWithTitleEngRows[0];
            const existingGameWithTitleKor = getGameWithTitleKorRows[0];

            if (existingGameWithTitleEng || existingGameWithTitleKor) {
                await poolClient.query('ROLLBACK');
                throw new ConflictException('이미존재하는 게임입니다');
            }

            //새로운게임추가
            const { rows: insertGameRows } = await poolClient.query<{
                idx: number;
            }>(
                `INSERT INTO
                    game(
                        title,
                        title_kor,
                        title_eng,
                        user_idx
                    )
                VALUES
                    ($1, $2, $3, $4)
                RETURNING
                    idx`,
                [title, titleKor, titleEng, request.userIdx]
            );
            const gameIdx = insertGameRows[0].idx;

            const newPostTitle = `새로운 게임 "${title}"이 생성되었습니다`;
            const newPostContent = `많은 이용부탁드립니다~`;

            await poolClient.query(
                `INSERT INTO
                    post(
                        title,
                        content,
                        user_idx,
                        game_idx
                    )
                VALUES
                    ($1, $2, $3, $4)`,
                [newPostTitle, newPostContent, loginUser.idx, gameIdx]
            );

            //게임 썸네일, 배너이미지 등록
            await poolClient.query(
                `INSERT INTO
                    game_img_thumbnail(
                        game_idx,
                        img_path
                    )
                VALUES
                    ($1, $2)`,
                [gameIdx, thumbnail[0].location]
            );

            await poolClient.query(
                `INSERT INTO
                    game_img_banner(
                        game_idx,
                        img_path
                    )
                VALUES
                    ($1, $2)`,
                [gameIdx, banner[0].location]
            );

            await poolClient.query('COMMIT');
            res.status(201).send();
        } catch (err) {
            await poolClient.query('ROLLBACK');
            next(err);
        } finally {
            if (poolClient) poolClient.release();
        }
    }
);

//승인요청온 게임목록보기
router.get('/game/request/all', checkLogin, checkAdmin, async (req, res, next) => {
    const lastIdx = parseInt(req.query.lastidx as string) || 99999999;
    try {
        let selectRequestRows: {
            idx: number;
            userIdx: number;
            title: string;
            isConfirmed: boolean;
            createdAt: Date;
        }[];
        if (!lastIdx) {
            // 최신 관리자알람 20개 출력
            ({ rows: selectRequestRows } = await pool.query(
                `SELECT
                    idx,
                    user_idx AS "userIdx",
                    title,
                    is_confirmed AS "isConfirmed",
                    created_at AS "createdAt"
                FROM
                    request
                WHERE 
                    deleted_at IS NULL
                ORDER BY
                    idx DESC
                LIMIT
                    20`
            ));
        } else {
            // lastIdx보다 작은 관리자알람 20개 출력
            ({ rows: selectRequestRows } = await pool.query(
                `
                SELECT
                    idx,
                    user_idx AS "userIdx",
                    title,
                    is_confirmed AS "isConfirmed",
                    created_at AS "createdAt"
                FROM
                    request
                WHERE 
                    deleted_at IS NULL
                AND
                    idx < $1
                ORDER BY
                    idx DESC
                LIMIT
                    20`,
                [lastIdx]
            ));
        }
        //요청이 없는 경우
        if (!selectRequestRows.length) {
            throw new BadRequestException('요청이 존재하지 않습니다.');
        }

        res.status(200).send({
            data: {
                lastIdx: selectRequestRows[selectRequestRows.length - 1].idx,
                requestList: selectRequestRows,
            },
        });
    } catch (err) {
        next(err);
    }
});

//승인요청 거부
router.delete('/game/request/:requestidx', checkLogin, checkAdmin, async (req, res, next) => {
    const requestIdx = req.params.requestidx;
    let poolClient: PoolClient;
    try {
        poolClient = await pool.connect();
        await poolClient.query(`BEGIN`);

        //요청삭제
        await poolClient.query(
            `UPDATE
                request
            SET 
                deleted_at = now(),
                is_confirmed = false
            WHERE 
                idx = $1`,
            [requestIdx]
        );

        //요청의 user_idx, 게임제목 추출
        const { rows: selectRequestRows } = await poolClient.query<{
            userIdx: number;
            title: string;
        }>(
            `SELECT
                user_idx AS "userIdx",
                title
            FROM 
                request
            WHERE 
                idx = $1`,
            [requestIdx]
        );

        //추출한 user_idx, 게임제목으로 새로운 게임 생성, 삭제 -> 그래야 거절 알림보낼 수 있음
        await poolClient.query(
            `INSERT INTO
                game(
                    user_idx,
                    title,
                    deleted_at
                )
            VALUES
                ($1, $2, now())`,
            [selectRequestRows[0].userIdx, selectRequestRows[0].title]
        );

        // 방금 생성,삭제된 게임idx 추출
        const { rows: latestGameRows } = await poolClient.query<{
            idx: number;
        }>(
            `SELECT
                idx
            FROM
                game
            ORDER BY
                idx DESC
            LIMIT
                1`
        );

        //알림생성
        await generateNotification({
            conn: poolClient,
            type: 'DENY_GAME',
            gameIdx: latestGameRows[0].idx,
            toUserIdx: selectRequestRows[0].userIdx,
        });

        await poolClient.query(`COMMIT`);

        res.status(200).send();
    } catch (e) {
        await poolClient.query(`ROLLBACK`);
        next(e);
    } finally {
        if (poolClient) poolClient.release();
    }
});

//배너이미지 등록
router.post(
    '/game/:gameidx/banner',
    checkLogin,
    checkAdmin,
    uploadS3.array('images', 1),
    async (req, res, next) => {
        const gameIdx = req.params.gameidx;
        let poolClient: PoolClient;

        try {
            const location = req.files[0].location;

            poolClient = await pool.connect();
            await poolClient.query(`BEGIN`);

            //기존배너이미지 삭제
            await poolClient.query(
                `UPDATE 
                    game_img_banner
                SET 
                    deleted_at = now()
                WHERE 
                    game_idx = $1
                AND 
                    deleted_at IS NULL`,
                [gameIdx]
            );
            //새로운배너이미지 추가
            await poolClient.query(
                `INSERT INTO
                    game_img_banner(
                        game_idx,
                        img_path
                    )
                VALUES
                    ($1, $2)`,
                [gameIdx, location]
            );
            await poolClient.query(`COMMIT`);
            res.status(201).send();
        } catch (err) {
            await poolClient.query(`ROLLBACK`);
            next(err);
        } finally {
            if (poolClient) poolClient.release();
        }
    }
);

//대표이미지 등록하기
router.post(
    '/game/:gameidx/thumbnail',
    checkLogin,
    checkAdmin,
    uploadS3.array('images', 1),
    async (req, res, next) => {
        const gameIdx = req.params.gameidx;
        let poolClient;
        try {
            poolClient = await pool.connect();
            const location = req.files[0].location;

            await poolClient.query(`BEGIN`);
            //기존 썸네일 삭제
            await poolClient.query(
                `UPDATE
                    game_img_thumbnail
                SET
                    deleted_at = now()
                WHERE
                    game_idx = $1
                AND
                    deleted_at IS NULL`,
                [gameIdx]
            );
            //새로운 썸네일 등록
            await poolClient.query(
                `INSERT INTO
                    game_img_thumbnail(
                        game_idx,
                        img_path
                    )
                VALUES 
                    ($1, $2)`,
                [gameIdx, location]
            );

            await poolClient.query(`COMMIT`);

            res.status(201).send();
        } catch (e) {
            await poolClient.query(`ROLLBACK`);
            next(e);
        } finally {
            if (poolClient) poolClient.release();
        }
    }
);

export default router;
