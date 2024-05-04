import Exception from './exception';

class NotFoundException extends Exception {
    constructor(message: string, err: any = null) {
        super(404, message, err);
        this.message = message;
        this.err = err;
    }
}

export default NotFoundException;
