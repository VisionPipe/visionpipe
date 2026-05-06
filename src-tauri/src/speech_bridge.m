#import <Foundation/Foundation.h>
#import <Speech/Speech.h>
#import <AVFoundation/AVFoundation.h>

// Returns the current SFSpeechRecognizer authorization status.
// 0 = notDetermined, 1 = denied, 2 = restricted, 3 = authorized
int speech_auth_status(void) {
    return (int)[SFSpeechRecognizer authorizationStatus];
}

// Request speech recognition authorization. Blocks until the user responds
// or 60 seconds elapse. Returns 1 if authorized, 0 otherwise, -1 on timeout.
//
// IMPORTANT: must NOT be called from the main thread. Apple's
// `SFSpeechRecognizer requestAuthorization:` dispatches its completion
// handler to the main queue — so if main is blocked waiting on the
// semaphore, the handler never runs and we deadlock until the timeout.
// Rust callers route through `tauri::async_runtime::spawn_blocking`.
//
// Defensive: if status is already determined (authorized/denied/restricted),
// short-circuit and return without prompting. macOS won't re-prompt after
// the first denial anyway — calling requestAuthorization in that state
// just returns the cached status.
int speech_request_auth(void) {
    SFSpeechRecognizerAuthorizationStatus current = [SFSpeechRecognizer authorizationStatus];
    if (current == SFSpeechRecognizerAuthorizationStatusAuthorized) return 1;
    if (current == SFSpeechRecognizerAuthorizationStatusDenied) return 0;
    if (current == SFSpeechRecognizerAuthorizationStatusRestricted) return 0;

    __block int result = -1;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);

    [SFSpeechRecognizer requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus status) {
        result = (status == SFSpeechRecognizerAuthorizationStatusAuthorized) ? 1 : 0;
        dispatch_semaphore_signal(sem);
    }];

    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 60 * NSEC_PER_SEC));
    return result;
}

// Request microphone access. Blocks until the user responds or 60 seconds
// elapse. Returns 1 if authorized, 0 otherwise, -1 on timeout.
//
// Same threading caveat as speech_request_auth: must not be called from
// the main thread. AVCaptureDevice's completion handler is dispatched to
// "an arbitrary queue" per Apple's docs (in practice, often a global
// concurrent queue), so it's less likely to deadlock than the speech
// handler — but routing through spawn_blocking on the Rust side keeps
// behavior consistent.
int mic_request_auth(void) {
    AVAuthorizationStatus current = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
    if (current == AVAuthorizationStatusAuthorized) return 1;
    if (current == AVAuthorizationStatusDenied) return 0;
    if (current == AVAuthorizationStatusRestricted) return 0;

    __block int result = -1;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);

    [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio completionHandler:^(BOOL granted) {
        result = granted ? 1 : 0;
        dispatch_semaphore_signal(sem);
    }];

    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 60 * NSEC_PER_SEC));
    return result;
}

// Returns the current microphone authorization status.
// 0 = notDetermined, 1 = restricted, 2 = denied, 3 = authorized
int mic_auth_status(void) {
    return (int)[AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
}

// Transcribe a WAV file using SFSpeechRecognizer.
// Returns a malloc'd C string with the transcript (caller must free), or NULL on error.
// On error, error_out is set to a malloc'd error message (caller must free).
char* speech_transcribe_file(const char* wav_path, char** error_out) {
    *error_out = NULL;

    SFSpeechRecognizerAuthorizationStatus status = [SFSpeechRecognizer authorizationStatus];
    if (status != SFSpeechRecognizerAuthorizationStatusAuthorized) {
        const char* msg = "Speech recognition not authorized. Enable it in System Settings > Privacy & Security > Speech Recognition.";
        *error_out = strdup(msg);
        return NULL;
    }

    SFSpeechRecognizer *recognizer = [[SFSpeechRecognizer alloc] initWithLocale:
        [NSLocale localeWithLocaleIdentifier:@"en-US"]];

    if (!recognizer || !recognizer.isAvailable) {
        *error_out = strdup("Speech recognizer not available");
        return NULL;
    }

    NSString *path = [NSString stringWithUTF8String:wav_path];
    NSURL *url = [NSURL fileURLWithPath:path];
    SFSpeechURLRecognitionRequest *request = [[SFSpeechURLRecognitionRequest alloc] initWithURL:url];
    request.shouldReportPartialResults = NO;

    __block char* resultStr = NULL;
    __block char* errStr = NULL;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);

    [recognizer recognitionTaskWithRequest:request resultHandler:^(SFSpeechRecognitionResult *result, NSError *error) {
        if (error) {
            const char* desc = [[error localizedDescription] UTF8String];
            errStr = strdup(desc ? desc : "Unknown recognition error");
            dispatch_semaphore_signal(sem);
            return;
        }
        if (result && result.isFinal) {
            const char* text = [result.bestTranscription.formattedString UTF8String];
            resultStr = strdup(text ? text : "");
            dispatch_semaphore_signal(sem);
        }
    }];

    long timeout = dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC));
    if (timeout != 0) {
        *error_out = strdup("Speech recognition timed out after 30 seconds");
        return NULL;
    }

    if (errStr) {
        *error_out = errStr;
        return NULL;
    }

    return resultStr ? resultStr : strdup("(no speech detected)");
}
