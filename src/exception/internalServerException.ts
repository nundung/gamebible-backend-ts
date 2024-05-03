import Exception from './exception';

class InternalServerException extends Exception {
    message: string;
    err: any;

    constructor(message: string, err: any = null) {
        super(500, message, err);
        this.message = message;
        this.err = err;
    }
}

export default InternalServerException;
