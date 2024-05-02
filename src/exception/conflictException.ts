import Exception from './exception';

class ConflictException extends Exception {
    message: string;
    err: any;

    constructor(message: string, err: any = null) {
        super(409, message, err);
        this.message = message;
        this.err = err;
    }
}

export default ConflictException;
