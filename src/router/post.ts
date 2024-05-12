import { Router } from 'express';
import { PoolClient } from 'pg';
import { body, param, query } from 'express-validator';

import pool from '../config/postgres';
import checkLogin from '../middleware/checkLogin';
import handleValidationError from '../middleware/validator';
import BadRequestException from '../exception/badRequestException';
import uploadS3 from '../middleware/upload';

const router = Router();

//게시글 업로드
router.post(
    '/',
    checkLogin,
    query('gameidx').isInt(),
    body('title').trim().isLength({ min: 2, max: 40 }).withMessage('제목은 2~40자로 입력해주세요'),
    body('content')
        .trim()
        .isLength({ min: 2, max: 10000 })
        .withMessage('본문은 2~10000자로 입력해주세요'),
    handleValidationError,
    async (req, res, next) => {
        const {
            title,
            content,
        }: {
            title: string;
            content: string;
        } = req.body;
        const gameIdxQuery = req.query.gameidx;
        const gameIdx = typeof gameIdxQuery === 'string' ? parseInt(gameIdxQuery, 10) : null;
        const loginUser = req.decoded;
        try {
            const { rows: uploadPostRows } = await pool.query<{
                gameIdx: number;
            }>(
                `INSERT INTO
                post(
                    user_idx,
                    game_idx,
                    title,
                    content,
                    created_at
                )
                VALUES
                    ($1, $2, $3, $4, null)
                RETURNING
                    game_idx AS "gameIdx"`,
                [loginUser.idx, gameIdx, title, content]
            );
            res.status(201).send({ data: uploadPostRows[0] });
        } catch (err) {
            next(err);
        }
    }
);

// 게시글 이미지 업로드
router.post('/image', checkLogin, uploadS3.array('images', 1), async (req, res, next) => {
    const images = req.files;
    try {
        if (!images) {
            throw new BadRequestException('이미지가 없습니다');
        }
        res.status(201).send({ data: images[0].location });
    } catch (err) {
        next(err);
    }
});

//게시판 보기 (게시글 목록보기)
//페이지네이션
//deleted_at 값이 null이 아닌 경우에는 탈퇴한 사용자
router.get('/all', query('page').isInt(), query('gameidx').isInt(), async (req, res, next) => {
    const pageQuery = req.query.page;
    const page = typeof pageQuery === 'string' ? parseInt(pageQuery, 10) : 1;
    const gameIdxQuery = req.query.gameidx;
    const gameIdx = typeof gameIdxQuery === 'string' ? parseInt(gameIdxQuery, 10) : null;
    try {
        // totalposts를 가져오는 별도의 쿼리
        const { rows: totalPostRows } = await pool.query<{
            count: number;
        }>(
            `SELECT
                count(*)
            FROM
                post
            WHERE
                game_idx = $1
            AND 
                deleted_at IS NULL`,
            [gameIdx]
        );
        //20개씩 불러오기
        const postsPerPage = 20;
        const offset = (page - 1) * postsPerPage;
        const maxPage = Math.ceil(totalPostRows[0].count / postsPerPage);
        const { rows: postRows } = await pool.query<{
            postIdx: number;
            title: string;
            createdAt: Date;
            userIdx: number;
            nickname: string;
        }>(
            `SELECT 
                post.idx AS "postIdx",
                post.title,
                post.created_at AS "createdAt",
                "user".idx AS "userIdx",
                "user".nickname,
            -- 조회수
            (
                SELECT
                    COUNT(*)::int
                FROM
                    view
                WHERE
                    post_idx = post.idx
            ) AS view
        FROM
                post
            JOIN
                "user" ON post.user_idx = "user".idx
            WHERE
                post.game_idx = $1
            AND 
                post.deleted_at IS NULL
            ORDER BY
                post.idx DESC
            LIMIT
                $2
            OFFSET
                $3`,
            [gameIdx, postsPerPage, offset]
        );
        res.status(200).send({
            data: postRows,
            page,
            maxPage,
            totalPosts: totalPostRows[0].count,
            offset,
            length: postRows.length,
        });
    } catch (err) {
        next(err);
    }
});

//게시글 검색하기
//페이지네이션
router.get(
    '/search',
    query('page').isInt(),
    query('title').trim().isLength({ min: 2 }).withMessage('2글자 이상입력해주세요'),
    async (req, res, next) => {
        const pageQuery = req.query.page;
        const page = typeof pageQuery === 'string' ? parseInt(pageQuery, 10) : 1;
        const title: string = req.query.title;
        try {
            // totalposts를 가져오는 별도의 쿼리
            const { rows: totalPostRows } = await pool.query<{
                count: number;
            }>(
                `SELECT
                    count(*)
                FROM
                    post
                WHERE
                    post.title LIKE '%' ||$1|| '%'
                AND 
                    deleted_at IS NULL`,
                [title]
            );
            //7개씩 불러오기
            const postsPerPage = 7;
            const offset = (page - 1) * postsPerPage;
            const maxPage = Math.ceil(totalPostRows[0].count / postsPerPage);
            const { rows: searchGameRows } = await pool.query<{
                gameIdx: number;
                postIdx: number;
                title: string;
                createdAt: Date;
                userIdx: number;
                nickname: string;
            }>(
                `SELECT 
                    post.game_idx AS "gameIdx",
                    post.idx AS "postIdx",
                    post.title,
                    post.created_at AS "createdAt",
                    "user".idx AS "userIdx",
                    "user".nickname,
                    -- 조회수
                    (
                        SELECT
                            COUNT(*)::int
                        FROM
                            view
                        WHERE
                            post_idx = post.idx 
                    ) AS view
                FROM 
                    post 
                LEFT JOIN
                    view ON post.idx = view.post_idx
                JOIN 
                    "user" ON post.user_idx = "user".idx
                WHERE
                    post.title LIKE '%' ||$1|| '%'
                AND 
                    post.deleted_at IS NULL
                ORDER BY
                    post.idx DESC
                LIMIT
                    $2
                OFFSET
                    $3`,
                [title, postsPerPage, offset]
            );
            res.status(200).send({
                data: searchGameRows,
                page,
                maxPage,
                totalPosts: totalPostRows[0].count,
                offset,
                length: searchGameRows.length,
            });
        } catch (err) {
            return next(err);
        }
    }
);

//게시글 상세보기
router.get('/:postidx', param('postidx').isInt(), checkLogin, async (req, res, next) => {
    const postIdxParams = req.params.postidx;
    const postIdx = typeof postIdxParams === 'string' ? parseInt(postIdxParams, 10) : 1;
    let poolClient: PoolClient;
    try {
        const loginUser = req.decoded;
        let isAuthor = false;
        poolClient = await pool.connect();
        await poolClient.query('BEGIN');
        await poolClient.query(
            `-- 조회수 반영하기
            INSERT INTO
                view(
                    post_idx,
                    user_idx
                )
            VALUES
                ($1, $2)`,
            [postIdx, loginUser.idx]
        );

        const { rows: postRows } = await poolClient.query<{
            title: string;
            content: string;
            createdAt: Date;
            gameIdx: number;
            userIdx: number;
            nickname: string;
        }>(
            `SELECT 
                post.title, 
                post.content,
                post.created_at AS "createdAt",
                post.game_idx AS "gameIdx",
                "user".idx AS "userIdx",
                "user".nickname,
                -- 조회수 불러오기
                (
                    SELECT
                        COUNT(*)::int
                    FROM
                        view
                    WHERE
                        post_idx = post.idx 
                ) AS view
            FROM 
                post
            JOIN
                "user" ON post.user_idx = "user".idx
            WHERE
                post.idx = $1
            AND 
                post.deleted_at IS NULL`,
            [postIdx]
        );
        if (loginUser.idx == postRows[0].userIdx) {
            isAuthor = true;
        }
        res.status(200).send({
            data: postRows[0],
            isAuthor: isAuthor,
        });
        await poolClient.query('COMMIT');
    } catch (err) {
        await poolClient.query('ROLLBACK');
        next(err);
    } finally {
        if (poolClient) poolClient.release();
    }
});

//게시글 삭제하기
router.delete('/:postidx', checkLogin, query('postidx').isInt(), async (req, res, next) => {
    const postIdxParams = req.params.postidx;
    const postIdx = typeof postIdxParams === 'string' ? parseInt(postIdxParams, 10) : 1;
    const loginUser = req.decoded;
    try {
        await pool.query(
            `UPDATE post
            SET
                deleted_at = now()
            WHERE
                idx = $1
            AND 
                user_idx = $2`,
            [postIdx, loginUser.idx]
        );
        res.status(200).send();
    } catch (err) {
        next(err);
    }
});

export default router;
