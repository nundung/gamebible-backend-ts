import nodemailer from 'nodemailer';

function sendVerificationEmail(email: string, code: string) {
    let transporter = nodemailer.createTransport({
        service: 'naver',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
    });

    let mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: '게임대장경 이메일 인증 코드',
        text: `귀하의 인증 코드는 ${code} 입니다.`,
    };

    transporter.sendMail(mailOptions, (err, info) => {
        if (err) {
            console.error('이메일 전송 실패: ', err);
        } else {
            console.log('이메일 전송 성공: ' + info.response);
        }
    });
}

export default sendVerificationEmail;
