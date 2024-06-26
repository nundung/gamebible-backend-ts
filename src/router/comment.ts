import { Router } from 'express';
import { PoolClient, PoolConfig } from 'pg';
import { body, query } from 'express-validator';

import pool from '../config/postgres';
import checkLogin from '../middleware/checkLogin';
import ForbiddenException from '../exception/forbiddenException';
import { generateNotification } from '../module/generateNotification';

require('dotenv').config();
const router = Router();

//댓글 쓰기
router.post(
    '/',
    checkLogin,
    body('content')
        .trim()
        .isLength({ min: 1, max: 1000 })
        .withMessage('내용은 1~1000자로 입력해주세요'),
    query('gameidx').isInt(),
    query('postidx').isInt(),
    async (req, res, next) => {
        const content: string = req.body.content;
        const gameIdxQuery = req.query.gameidx;
        const gameIdx = typeof gameIdxQuery === 'string' ? parseInt(gameIdxQuery, 10) : null;
        const postIdxQuery = req.query.lastIdx;
        const postIdx = typeof postIdxQuery === 'string' ? parseInt(postIdxQuery, 10) : null;
        let poolClient: PoolClient;
        try {
            const loginUser = req.decoded;
            poolClient = await pool.connect();
            await poolClient.query('BEGIN');

            //댓글 추가
            await poolClient.query(
                `INSERT INTO
                    comment(
                        user_idx,
                        post_idx,
                        content
                    )
                VALUES
                    ($1, $2, $3)`,
                [loginUser.idx, postIdx, content]
            );

            //글쓴이에게 알람 전송
            const { rows: sendNotificationRows } = await poolClient.query(
                `SELECT
                    user_idx
                FROM
                    post
                WHERE
                    idx = $1`,
                [postIdx]
            );
            await generateNotification({
                conn: poolClient,
                type: 'MAKE_COMMENT',
                gameIdx: gameIdx,
                postIdx: postIdx,
                toUserIdx: sendNotificationRows[0].user_idx,
            });
            await poolClient.query('COMMIT');
            return res.status(201).end();
        } catch (err) {
            if (poolClient) {
                await poolClient.query(`ROLLBACK`);
            }
            next(err);
        } finally {
            if (poolClient) {
                poolClient.release();
            }
        }
    }
);

//댓글 보기
//무한스크롤
router.get('/all', checkLogin, async (req, res, next) => {
    const lastIdxQuery = req.query.lastIdx;
    const lastIdx = typeof lastIdxQuery === 'string' ? parseInt(lastIdxQuery, 10) : 99999999;
    const postIdxQuery = req.query.lastIdx;
    const postIdx = typeof postIdxQuery === 'string' ? parseInt(postIdxQuery, 10) : null;
    try {
        const loginUser = req.decoded;
        //20개씩 불러오기
        const { rows: commentRows } = await pool.query<{
            idx: number;
            content: string;
            createdAt: Date;
            userIdx: number;
            nickname: string;
        }>(
            `SELECT
                comment.idx,
                comment.content,
                comment.created_at AS "createdAt",
                "user".idx AS "userIdx",
                "user".nickname
            FROM
                comment
            JOIN
                "user" ON comment.user_idx = "user".idx
            WHERE
                post_idx = $1
            AND 
                comment.deleted_at IS NULL
            AND
                comment.idx > $2
            ORDER BY
                comment.idx ASC
            LIMIT
                20`,
            [postIdx, lastIdx]
        );
        if (!commentRows || !commentRows.length) {
            res.status(204).end();
        }

        // totalcomment의 개수를 가져오는 별도의 쿼리
        const { rows: totalCommentNumberRows } = await pool.query<{
            totalCommentNumber: number;
        }>(
            `SELECT
                COUNT(*)::int AS "totalCommentNumber"
            FROM
                comment
            WHERE
                post_idx = $1
            AND 
                deleted_at IS NULL`,
            [postIdx]
        );
        res.status(200).send({
            data: commentRows,
            lastIdx: commentRows[commentRows.length - 1].idx,
            totalComments: totalCommentNumberRows[0].totalCommentNumber,
        });
    } catch (err) {
        next(err);
    }
});

//댓글 삭제
router.delete('/:commentidx', checkLogin, async (req, res, next) => {
    const commentIdxParams = req.params.gameidx;
    const commentIdx = typeof commentIdxParams === 'string' ? parseInt(commentIdxParams, 10) : null;
    try {
        const loginUser = req.decoded;
        const { rows: deleteCommentRows } = await pool.query<{
            idx: number;
        }>(
            `UPDATE comment
            SET
                deleted_at = now()
            WHERE
                idx = $1
            AND 
                user_idx = $2
            RETURNING
                idx`,
            [commentIdx, loginUser.idx]
        );
        if (deleteCommentRows.length === 0) {
            throw new ForbiddenException('댓글 삭제 실패');
        }
        res.status(200).send();
    } catch (err) {
        next(err);
    }
});

export default router;
