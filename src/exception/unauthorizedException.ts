import Exception from './exception';

export default class UnauthorizedException extends Exception {
    constructor(message: string, err: any = null) {
        super(401, message, err);
        this.message = message;
        this.err = err;
    }
}
