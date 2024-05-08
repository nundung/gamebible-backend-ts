import { Router } from 'express';
import { validationResult } from 'express-validator';
import pool from '../config/postgres';
import BadRequestException from '../exception/badRequestException';

const router = Router();
// 날짜 형식은 2000-01-01
const validateDate = (date: string) => {
    const dateReg = /^\d{4}-\d{2}-\d{2}$/;
    return !date || dateReg.test(date);
};

// API Validate
const validateApi = (api: string) => {
    const validApis = ['account', 'admin', 'game', 'post', 'comment', 'visitor', 'log'];
    return !api || validApis.includes(api);
};

// 로그목록 보기
router.get('/', async (req, res, next) => {
    const {
        startdate: startDate,
        enddate: endDate,
        idx,
        api,
    } = req.query as {
        startdate: string | null;
        enddate: string | null;
        idx: string | null;
        api: string | null;
    };
    // Express Validator를 사용하여 검증 결과 확인
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        throw new BadRequestException(JSON.stringify({ errors: errors.array() }));
    }
    try {
        let values = [];
        let query = `
            SELECT 
                * 
            FROM 
                log
            WHERE 
                1=1`;
        if (startDate && validateDate(startDate)) {
            query += ` AND requested_timestamp >= $${values.length + 1}`;
            values.push(startDate);
        }
        if (endDate && validateDate(endDate)) {
            query += ` AND requested_timestamp <= $${values.length + 1}`;
            values.push(endDate);
        }
        if (idx) {
            query += ` AND idx = $${values.length + 1}`;
            values.push(idx);
        }
        if (api && validateApi(api)) {
            query += ` AND url LIKE $${values.length + 1}`;
            values.push(`%/${api}%`);
        }
        query += ` ORDER BY requested_timestamp DESC`;
        console.log(query);
        const result = await pool.query(query, values);
        res.status(200).send(result.rows);
    } catch (err) {
        next(err);
    }
});

export default router;
