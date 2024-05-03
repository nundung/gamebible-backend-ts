import bcrypt = require('bcrypt');
import InternalServerException from '../exception/internalServerException';

const hashPassword = async (password) => {
    console.log(password);
    const saltRounds = 10;
    try {
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        return hashedPassword;
    } catch (err) {
        throw new InternalServerException('비밀번호 해싱 중 에러 발생');
    }
};

export default hashPassword;
