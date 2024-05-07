import { PoolClient } from 'pg';

import pool from '../config/postgres';

interface NotificationOption {
    //pool은 1회용 연결
    //poolClient은 다회용 연결, 트랜잭션사용, 따로 반납해야함
    conn?: PoolClient;
    type?: string;
    gameIdx: number;
    toUserIdx: number;
    postIdx?: number;
}

const generateNotification = async (option: NotificationOption) => {
    let notificationType: number = null;

    if (option.type == 'MAKE_COMMENT') notificationType = 1;
    else if (option.type == 'MODIFY_GAME') notificationType = 2;
    else if (option.type == 'DENY_GAME') notificationType = 3;

    (option.conn || pool).query(
        `INSERT INTO
            notification(
                type,
                user_idx,
                game_idx,
                post_idx
            )
        VALUES
            ($1, $2, $3, $4)`,
        [notificationType, option.toUserIdx, option.gameIdx, option.postIdx || null]
    );
};

const generateNotifications = async (option) => {
    (option.conn || pool).query(
        `INSERT INTO
                notification(
                    type,
                    game_idx,
                    post_idx,
                    user_idx
                )
            SELECT
                2, $1, NULL,
            UNNEST($2::int[])`,
        [option.gameIdx, option.toUserIdx]
    );
};

export { generateNotification, generateNotifications };
