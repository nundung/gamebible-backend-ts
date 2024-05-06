//Import
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
import multer, { Options } from 'multer';
import multerS3 from 'multer-s3';

//aws region 설정
const s3Client = new S3Client({
    region: 'ap-northeast-2',
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
});

const fileFilter: Options['fileFilter'] = (req, file, cb) => {
    if (file.mimetype.split('/')[0] != 'image') {
        return cb(new Error('이미지 형식이 올바르지 않습니다.'));
    }

    const maxSize = 10 * 1024 * 1024; // 10MB를 최대 파일 크기로 지정
    if (file.size > maxSize) {
        return cb(new Error('파일 크기가 너무 큽니다. 최대 10MB까지 허용됩니다.'));
    }

    cb(null, true); // 모든 검증을 통과한 경우, 파일을 업로드 허용
};

const uploadS3 = multer({
    storage: multerS3({
        s3: s3Client,
        bucket: process.env.S3_BUCKET_NAME,
        contentType: multerS3.AUTO_CONTENT_TYPE,
        key(req, file, cb) {
            cb(null, `${Date.now()}_${file.originalname}`);
        },
        acl: 'public-read-write',
    }),
    fileFilter: fileFilter, // 파일 필터링 함수 설정
});

export default uploadS3;
