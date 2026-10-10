package handler

import (
	"errors"
	"fmt"
	"mime/multipart"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	maxNameLen  = 100
	minInterval = 1
	maxInterval = 365
)

var errTooLarge = errors.New("file too large")

func validateName(s string) (string, error) {
	name := strings.TrimSpace(s)
	if name == "" {
		return "", errors.New("name is required")
	}
	if utf8.RuneCountInString(name) > maxNameLen {
		return "", fmt.Errorf("name must be at most %d characters", maxNameLen)
	}
	return name, nil
}

func validateInterval(days int) error {
	if days < minInterval || days > maxInterval {
		return fmt.Errorf("water_every_days must be between %d and %d", minInterval, maxInterval)
	}
	return nil
}

// validatePastDate accepts nil/"" (meaning "today") or a YYYY-MM-DD that is not
// in the future. One day of slack covers browsers ahead of the server's UTC date.
func validatePastDate(field string, d *string) (*string, error) {
	if d == nil || *d == "" {
		return nil, nil
	}
	t, err := time.Parse(time.DateOnly, *d)
	if err != nil {
		return nil, fmt.Errorf("%s must be YYYY-MM-DD", field)
	}
	if t.After(time.Now().UTC().AddDate(0, 0, 1)) {
		return nil, fmt.Errorf("%s cannot be in the future", field)
	}
	return d, nil
}

func validateUpload(fh *multipart.FileHeader, maxBytes int64) error {
	if fh.Size == 0 {
		return errors.New("file is empty")
	}
	if fh.Size > maxBytes {
		return fmt.Errorf("%w: max %d bytes", errTooLarge, maxBytes)
	}
	return nil
}
