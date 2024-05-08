import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: false }));

import logger from './middleware/logger';
import accountApi from './router/account';
import adminApi from './router/admin';
import commentApi from './router/comment';
import gameApi from './router/game';
import logApi from './router/log';
import postApi from './router/post';

app.use(logger);

app.use('/account', accountApi);
app.use('/admin', adminApi);
app.use('/comment', commentApi);
app.use('/game', gameApi);
app.use('/log', logApi);
app.use('/post', postApi);

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.log(err);
    res.status(err.status || 500).send({
        message: err.status ? err.message : '예상하지 못한 에러가 발생했습니다.',
    });
});

app.listen(process.env.HTTP_PORT, () => {
    console.log(`${process.env.HTTP_PORT}번 포트번호 서버실행`);
});
