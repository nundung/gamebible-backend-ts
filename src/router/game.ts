import { Router } from 'express';
import { Pool, PoolClient } from 'pg';
import axios from 'axios';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { body, query } from 'express-validator';

import pool from '../config/postgres';
import checkLogin from '../middleware/checkLogin';
import handleValidationError from '../middleware/validator';
import ConflictException from '../exception/conflictException';
import { stringList } from 'aws-sdk/clients/datapipeline';

require('dotenv').config();
const router = Router();

//게임생성요청
router.post(
    '/request',
    checkLogin,
    body('title').trim().isLength({ min: 2 }).withMessage('2글자이상입력해주세요'),
    handleValidationError,
    async (req, res, next) => {
        const title: string = req.body;
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
            const existingGame = selectGameRows[0];
            if (existingGame) {
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
router.get('/all', async (req, res, next) => {
    let page = parseInt(req.query.page as string) || 1;
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
        const { rows: totalGamesNumberRows } = await pool.query(
            `SELECT
                count(*)
            FROM
                game
            WHERE
                deleted_at IS NULL`
        );
        const maxPage = Math.ceil(totalGamesNumberRows[0].count / 20);

        res.status(200).send({
            data: {
                maxPage: maxPage,
                page: page,
                skip: skip,
                count: totalGamesNumberRows.length,
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
router.get('/popular', async (req, res, next) => {
    const page = Number(req.query.page) || 1;
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
        const totalGamesRows = await pool.query<{}>(`
            SELECT
                count(*)
            FROM
                game g
            WHERE
                deleted_at IS NULL    
        `);
        const maxPage = Math.ceil((totalGamesRows[0].count - 19) / 16) + 1;

        const popularSelectSQLResult = await pool.query(
            //게시글 수가 많은 게임 순서대로 게임 idx, 제목, 이미지경로 추출
            `
                SELECT
                    g.idx, g.title, count(*) AS "postCount" ,t.img_path  AS "imgPath"
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
        const popularGameList = popularSelectSQLResult.rows;

        if (!popularGameList.length) return res.status(204).send();

        res.status(200).send({
            data: {
                maxPage: maxPage,
                page: page,
                skip: skip,
                count: popularGameList.length,
                gameList: popularGameList,
            },
        });
    } catch (e) {
        next(e);
    }
});

//배너이미지가져오기
router.get('/:gameidx/banner', async (req, res, next) => {
    const gameIdx = req.params.gameidx;
    try {
        //삭제되지않은 배너이미지경로 가져오기
        const bannerSQLResult = await pool.query(
            `
            SELECT
                img_path AS "imgPath"
            FROM 
                game_img_banner
            WHERE
                game_idx = $1
            AND
                deleted_at IS NULL`,
            [gameIdx]
        );
        const banner = bannerSQLResult.rows;
        res.status(200).send({
            data: banner,
        });
    } catch (e) {
        next(e);
    }
});
