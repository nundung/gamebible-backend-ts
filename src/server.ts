import express from 'express';
import { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: false }));

app.listen(process.env.HTTP_PORT, () => {
    console.log(`${process.env.HTTP_PORT}번 포트번호 서버실행`);
});
