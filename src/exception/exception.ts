class Exception extends Error {
    status: number;
    message: string;
    err: any;

    constructor(status: number, message: string, err: any = null) {
        super(err);
        this.status = status;
        this.message = message;
        this.err = err;
    }
}

export default Exception;
