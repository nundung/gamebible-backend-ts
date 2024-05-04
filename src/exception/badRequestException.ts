import Exception from './exception';

class BadRequestException extends Exception {
    constructor(message: string, err: any = null) {
        super(400, message, err);
        this.message = message;
        this.err = err;
    }
}

export default BadRequestException;
