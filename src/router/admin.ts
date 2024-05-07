import { Router } from 'express';
import { PoolClient, PoolConfig } from 'pg';

import pool from '../config/postgres';
import uploadS3 from '../middleware/upload';
import checkLogin from '../middleware/checkLogin';
import checkAdmin from '../middleware/checkAdmin';
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
            const deleteRequestSQLResult = await poolClient.query(
                `
            UPDATE
                request
            SET 
                deleted_at = now(), is_confirmed = true
            WHERE 
                idx = $1
            RETURNING
                user_idx AS "userIdx" , title`,
                [requestIdx]
            );
            const request = deleteRequestSQLResult.rows[0];

            //트랜잭션 시작
            await poolClient.query('BEGIN');

            //기존 게임중복확인(영어)
            const getGameWithTitleEng = await poolClient.query(
                `
                SELECT
                    *
                FROM
                    game
                WHERE
                    title_eng = $1
                AND
                    deleted_at IS NULL`,
                [titleEng]
            );

            //기존 게임중복확인(한글)
            const getGameWithTitleKor = await poolClient.query(
                `
                SELECT
                    *
                FROM
                    game
                WHERE
                    title_kor = $1
                AND
                    deleted_at IS NULL`,
                [titleKor]
            );

            const existingGameWithTitleEng = getGameWithTitleEng.rows[0];
            const existingGameWithTitleKor = getGameWithTitleKor.rows[0];

            if (existingGameWithTitleEng || existingGameWithTitleKor) {
                await poolClient.query('ROLLBACK');
                return res.status(409).send({ message: '이미존재하는 게임입니다' });
            }

            //새로운게임추가
            const insertGameSQLResult = await poolClient.query(
                `
                INSERT INTO
                    game(title, title_kor, title_eng ,user_idx)
                VALUES
                    ( $1, $2, $3, $4 )
                RETURNING
                    idx AS "gameIdx"`,
                [title, titleKor, titleEng, request.userIdx]
            );
            const gameIdx = insertGameSQLResult.rows[0].gameIdx;

            const newPostTitle = `새로운 게임 "${title}"이 생성되었습니다`;
            const newPostContent = `많은 이용부탁드립니다~`;

            await poolClient.query(
                `
                INSERT INTO
                    post(title, content, user_idx, game_idx)
                VALUES
                    ( $1, $2, $3, $4 )`,
                [newPostTitle, newPostContent, loginUser.idx, gameIdx]
            );

            //게임 썸네일, 배너이미지 등록
            await poolClient.query(
                `
                INSERT INTO
                    game_img_thumbnail(game_idx, img_path)
                VALUES ( $1, $2 )`,
                [gameIdx, thumbnail[0].location]
            );

            await poolClient.query(
                `
                INSERT INTO
                    game_img_banner(game_idx, img_path)
                VALUES ( $1, $2 )`,
                [gameIdx, banner[0].location]
            );

            await poolClient.query('COMMIT');

            res.status(201).send();
        } catch (e) {
            await poolClient.query('ROLLBACK');
            next(e);
        } finally {
            if (poolClient) poolClient.release();
        }
    }
);
