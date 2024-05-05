import nodemailer from 'nodemailer';
import pool from '../config/postgres.js';
import jwt from 'jsonwebtoken';
import NotFoundException from '../exception/notFoundException.js';

const changePwEmail = async (email: string) => {
    let transporter = nodemailer.createTransport({
        service: 'naver',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
    });
    const { rows: userRows } = await pool.query(
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
    if (userRows.length === 0) {
        throw new NotFoundException('사용자 정보 조회 실패');
    }

    const idx = userRows[0].idx;

    const token = jwt.sign(
        {
            idx: idx,
        },
        process.env.SECRET_KEY,
        {
            expiresIn: '3m',
        }
    );

    const resetLink = `https://http://localhost:3000/account/pw?token=${token}`;

    let mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: '게임대장경 비밀번호 변경 링크',
        html: `<p>비밀번호를 변경하려면 아래 링크를 클릭하세요:</p><a href="${resetLink}">비밀번호 변경하기</a>`,
    };

    transporter.sendMail(mailOptions, (err, info) => {
        if (err) {
            console.error('이메일 전송 실패: ', err);
        } else {
            console.log('이메일 전송 성공: ' + info.response);
        }
    });
    return token;
};

export default changePwEmail;
