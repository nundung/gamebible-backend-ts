import Exception from './exception';

class ForbiddenException extends Exception {
    constructor(message: string, err: any = null) {
        super(403, message, err);
        this.message = message;
        this.err = err;
    }
}

export default ForbiddenException;
