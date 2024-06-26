import { Router } from 'express';
import { PoolClient } from 'pg';
import { body, query, param } from 'express-validator';

import pool from '../config/postgres';
import checkLogin from '../middleware/checkLogin';
import handleValidationError from '../middleware/validator';
import ConflictException from '../exception/conflictException';
import { generateNotification } from '../module/generateNotification';
import uploadS3 from '../middleware/upload';
import BadRequestException from '../exception/badRequestException';

require('dotenv').config();
const router = Router();

//게임생성요청
router.post(
    '/request',
    checkLogin,
    body('title').trim().isLength({ min: 2 }).withMessage('2글자이상입력해주세요'),
    handleValidationError,
    async (req, res, next) => {
        const title: string = req.body.title;
        const loginUser = req.decoded;
        try {
            const { rows: selectGameRows } = await pool.query(
                `SELECT
                    *
                FROM
                    game
                WHERE
                    title = $1
                AND
                    deleted_at IS NULL`,
                [title]
            );
            if (selectGameRows[0]) {
                throw new ConflictException('이미존재하는 게임');
            }
            await pool.query(
                `INSERT INTO 
                    request(
                        user_idx,
                        title
                    ) 
                VALUES 
                    ($1 ,$2)`,
                [loginUser.idx, title]
            );
            res.status(200).send();
        } catch (err) {
            next(err);
        }
    }
);

//게임목록불러오기
router.get('/all', query('page').isInt(), async (req, res, next) => {
    const pageQuery = req.query.gameidx;
    const page = typeof pageQuery === 'string' ? parseInt(pageQuery, 10) : 1;
    //20개씩 불러오기
    const skip = (page - 1) * 20;
    try {
        const { rows: selectGameRows } = await pool.query<{
            idx: number;
            userIdx: number;
            title: string;
            createdAt: Date;
        }>(
            `SELECT 
                idx,
                user_idx AS "userIdx",
                title,
                created_at AS "createdAt"
            FROM 
                game
            WHERE 
                deleted_at IS NULL 
            ORDER BY 
                title ASC
            LIMIT
                20
            OFFSET
                $1`,
            [skip]
        );
        if (!selectGameRows || !selectGameRows.length) {
            return res.status(204).send();
        }

        //totalgame의 개수를 가져오는 별도의 쿼리
        const { rows: totalGameRows } = await pool.query<{
            count: number;
        }>(
            `SELECT
                count(*)
            FROM
                game
            WHERE
                deleted_at IS NULL`
        );
        const maxPage = Math.ceil(totalGameRows[0].count / 20);

        res.status(200).send({
            data: {
                maxPage: maxPage,
                page: page,
                skip: skip,
                count: totalGameRows.length,
                gameList: selectGameRows,
            },
        });
    } catch (err) {
        next(err);
    }
});

//게임검색하기
router.get(
    '/search',
    query('title').trim().isLength({ min: 2 }).withMessage('2글자 이상입력해주세요'),
    handleValidationError,
    async (req, res, next) => {
        const title: string = req.query.title;
        try {
            const { rows: searchGameRows } = await pool.query<{
                idx: number;
                title: string;
                imgPath: string;
            }>(
                `SELECT
                    g.idx,
                    g.title,
                    t.img_path AS "imgPath"
                FROM
                    game g
                JOIN
                    game_img_thumbnail t
                ON
                    g.idx = t.game_idx
                WHERE
                    title_kor
                ILIKE
                    $1
                OR
                    title_eng
                ILIKE
                    $1
                AND
                    t.deleted_at IS NULL`,
                [`%${title}%`]
            );
            if (!searchGameRows.length) {
                return res.status(204).send();
            }
            res.status(200).send({
                data: searchGameRows,
            });
        } catch (err) {
            next(err);
        }
    }
);

//인기게임목록불러오기(게시글순)
router.get('/popular', query('page').isInt(), async (req, res, next) => {
    const pageQuery = req.query.page;
    const page = typeof pageQuery === 'string' ? parseInt(pageQuery, 10) : 1;
    let skip: number;
    let count: number;
    if (page == 1) {
        //1페이지는 19개 불러오기
        count = 19;
        skip = 0;
    } else {
        //2페이지부터는 16개씩불러오기
        count = 16;
        skip = (page - 1) * 16 + 3;
    }

    try {
        const { rows: totalGameRows } = await pool.query<{
            count: number;
        }>(`
            SELECT
                count(*)
            FROM
                game
            WHERE
                deleted_at IS NULL
        `);
        const maxPage = Math.ceil((totalGameRows[0].count - 19) / 16) + 1;

        const { rows: popularGameRows } = await pool.query<{
            idx: number;
            title: string;
            postCount: number;
            imgPath: string;
        }>(
            //게시글 수가 많은 게임 순서대로 게임 idx, 제목, 이미지경로 추출
            `
                SELECT
                    g.idx,
                    g.title,
                    count(*) AS "postCount",
                    t.img_path AS "imgPath"
                FROM 
                    game g
                JOIN
                    post p
                ON
                    g.idx = p.game_idx
                JOIN
                    game_img_thumbnail t
                ON
                    g.idx = t.game_idx
                WHERE
                    t.deleted_at IS NULL
                GROUP BY
                    g.title, t.img_path , g.idx
                ORDER BY
                    "postCount" DESC
                LIMIT
                    $1
                OFFSET
                    $2`,
            [count, skip]
        );
        if (!popularGameRows.length) return res.status(204).send();

        res.status(200).send({
            data: {
                maxPage: maxPage,
                page: page,
                skip: skip,
                count: popularGameRows.length,
                gameList: popularGameRows,
            },
        });
    } catch (err) {
        next(err);
    }
});

//배너이미지 가져오기
router.get('/:gameidx/banner', query('gameidx').isInt(), async (req, res, next) => {
    const gameIdxQuery = req.query.gameidx;
    const gameIdx = typeof gameIdxQuery === 'string' ? parseInt(gameIdxQuery, 10) : null;
    try {
        //삭제되지않은 배너이미지경로 가져오기
        const { rows: bannerRows } = await pool.query<{
            imgPath: string;
        }>(
            `SELECT
                img_path AS "imgPath"
            FROM 
                game_img_banner
            WHERE
                game_idx = $1
            AND
                deleted_at IS NULL`,
            [gameIdx]
        );
        res.status(200).send({
            data: bannerRows,
        });
    } catch (err) {
        next(err);
    }
});

//히스토리 목록보기
router.get('/:gameidx/history/all', query('gameidx').isInt(), async (req, res, next) => {
    const gameIdxQuery = req.query.gameidx;
    const gameIdx = typeof gameIdxQuery === 'string' ? parseInt(gameIdxQuery, 10) : null;
    try {
        //특정게임 히스토리목록 최신순으로 출력
        const { rows: selectHistoryRows } = await pool.query<{
            idx: number;
            createdAt: Date;
            nickname: string;
        }>( // history idx, 히스토리 제목(YYYY-MM-DD HH24:MI:SS 사용자닉네임) 출력
            `SELECT
                h.idx,
                TO_CHAR(
                    h.created_at AT TIME ZONE 'Asia/Seoul',
                    'YYYY-MM-DD HH24:MI:SS'
                    ) AS "createdAt",
                nickname
            FROM
                history h
            JOIN
                "user" u
            ON
                h.user_idx = u.idx
            WHERE
                game_idx = $1
            AND
                h.created_at IS NOT NULL
            ORDER BY
                h.created_at DESC`,
            [gameIdx]
        );

        const { rows: selectGameRows } = await pool.query<{
            idx: number;
            title: string;
        }>(
            `SELECT
                idx,
                title
            FROM
                game
            WHERE
                idx = $1
            `,
            [gameIdx]
        );

        res.status(200).send({
            data: {
                idx: selectGameRows[0].idx,
                title: selectGameRows[0].title,
                historyList: selectHistoryRows,
            },
        });
    } catch (err) {
        next(err);
    }
});

//히스토리 자세히보기
router.get(
    '/:gameidx/history/:historyidx?',
    param('gameidx').isInt(),
    param('historyidx').isInt(),
    async (req, res, next) => {
        const historyIdxParams = req.params.historyidx;
        let historyIdx =
            typeof historyIdxParams === 'string' ? parseInt(historyIdxParams, 10) : null;
        const gameIdxParams = req.params.gameidx;
        let gameIdx = typeof gameIdxParams === 'string' ? parseInt(gameIdxParams, 10) : null;
        try {
            if (!historyIdx) {
                //가장 최신 히스토리idx 출력
                const { rows: getLatestHistoryIdxRows } = await pool.query<{
                    maxIdx: number;
                }>(
                    `SELECT
                    MAX(idx) AS "maxIdx"
                FROM
                    history
                WHERE
                    game_idx = $1
                AND
                    created_at IS NOT NULL`,
                    [gameIdx]
                );
                historyIdx = getLatestHistoryIdxRows[0].maxIdx;
            }

            const { rows: getHistoryRows } = await pool.query<{
                historyIdx: number;
                gameIdx: number;
                userIdx: number;
                title: string;
                content: string;
                createdAt: Date;
                nickname: string;
            }>(
                //히스토리 idx, gameidx, useridx, 내용, 시간, 닉네임 출력
                `SELECT
                h.idx AS "historyIdx",
                h.game_idx AS "gameIdx",
                h.user_idx AS "userIdx",
                title,
                content,
                h.created_at AS "createdAt",
                u.nickname
            FROM 
                history h
            JOIN
                "user" u
            ON
                h.user_idx = u.idx
            JOIN
                game g
            ON 
                g.idx = h.game_idx
            WHERE 
                h.idx = $1
            AND 
                game_idx = $2`,
                [historyIdx, gameIdx]
            );
            const history = getHistoryRows;

            res.status(200).send({ data: history });
        } catch (err) {
            next(err);
        }
    }
);

//게임 수정하기
router.put(
    '/:gameidx/wiki',
    checkLogin,
    query('gameidx').isInt(),
    body('content').trim().isLength({ min: 2 }).withMessage('2글자이상 입력해주세요'),
    handleValidationError,
    async (req, res, next) => {
        const gameIdxQuery = req.query.gameidx;
        const gameIdx = typeof gameIdxQuery === 'string' ? parseInt(gameIdxQuery, 10) : null;
        const content: string = req.body.content;
        const loginUser = req.decoded;

        let poolClient: PoolClient = null;
        try {
            poolClient = await pool.connect();
            await poolClient.query(`BEGIN`);

            //기존 게임수정자들 추출
            const { rows: historyUserRows } = await poolClient.query<{
                userIdx: number;
            }>(
                `SELECT DISTINCT
                    user_idx AS "userIdx"
                FROM
                    history
                WHERE
                    game_idx = $1`,
                [gameIdx]
            );
            const userIdxList = historyUserRows.map((elem) => elem.userIdx);
            for (const userIdx of userIdxList) {
                await generateNotification({
                    conn: poolClient,
                    type: 'MODIFY_GAME',
                    gameIdx: gameIdx,
                    toUserIdx: userIdx,
                });
            }

            // 새로운 히스토리 등록
            await poolClient.query(
                `INSERT INTO
                    history(
                        game_idx,
                        user_idx,
                        content
                    )
                VALUES
                    ($1, $2, $3)`,
                [gameIdx, loginUser.idx, content]
            );
            await poolClient.query(`COMMIT`);
            res.status(201).send();
        } catch (err) {
            await poolClient.query(`ROLLBACK`);
            next(err);
        } finally {
            if (poolClient) {
                poolClient.release();
            }
        }
    }
);

// 임시위키생성
router.post('/:gameidx/wiki', checkLogin, param('gameidx').isInt(), async (req, res, next) => {
    const gameIdxParams = req.params.gameidx;
    const gameIdx = typeof gameIdxParams === 'string' ? parseInt(gameIdxParams, 10) : null;
    const loginUser = req.decoded;
    try {
        const { rows: temporaryHistoryRows } = await pool.query<{
            idx: number;
        }>(
            `INSERT INTO 
                history(
                    game_idx,
                    user_idx,
                    created_at
                )
            VALUES
                ($1, $2, null)
            RETURNING
                idx`,
            [gameIdx, loginUser.idx]
        );

        //기존 게임내용 불러오기
        const { rows: getLatestHistoryRows } = await pool.query<{
            title: string;
            content: string;
        }>(
            `SELECT 
                g.title,
                h.content
            FROM 
                history h
            JOIN 
                game g
            ON
                h.game_idx = g.idx
            WHERE
                h.game_idx = $1
            AND
                h.created_at IS NOT NULL
            ORDER BY
                h.created_at DESC
            limit
                1`,
            [gameIdx]
        );
        res.status(201).send({
            historyIdx: temporaryHistoryRows[0].idx,
            title: getLatestHistoryRows[0].title,
            content: getLatestHistoryRows[0].content,
        });
    } catch (err) {
        next(err);
    }
});

// 위키 이미지 업로드
router.post(
    '/:gameidx/wiki/image',
    checkLogin,
    param('historyidx').isInt(),
    uploadS3.array('images', 1),
    async (req, res, next) => {
        const historyIdxParams = req.params.historyidx;
        const historyIdx =
            typeof historyIdxParams === 'string' ? parseInt(historyIdxParams, 10) : null;
        const images = req.files;
        try {
            if (!images) {
                throw new BadRequestException('이미지가 없습니다');
            }
            await pool.query(
                `INSERT INTO
                    game_img( history_idx, img_path )
                VALUES ($1, $2)`,
                [historyIdx, location]
            );
            res.status(201).send({ data: location });
        } catch (err) {
            next(err);
        }
    }
);

export default router;
