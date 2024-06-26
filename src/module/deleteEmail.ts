import { Pool } from 'pg';

const deleteExpiredCodes = async (pool: Pool) => {
    try {
        const { rowCount: DeleteCount } = await pool.query(
            `DELETE
            FROM
                email_verification
            WHERE
                created_at < NOW() - INTERVAL '5 minutes'`
        );
        console.log(`${DeleteCount}개 code 지워짐`);
    } catch (err) {
        console.error('Error deleting expired records:', err);
    }
};

async function deleteCode(pool: Pool) {
    setTimeout(() => {
        deleteExpiredCodes(pool);
    }, 5 * 60 * 1000);
}

export default deleteCode;
