package main

import (
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

var version = "dev"

type launchStatus struct {
	LauncherPID int    `json:"launcherPid"`
	ServerPID   int    `json:"serverPid"`
	URL         string `json:"url"`
	Port        int    `json:"port"`
}

func main() {
	showVersion := flag.Bool("version", false, "print the launcher version")
	stop := flag.Bool("stop", false, "stop a running Service Maestro desktop instance")
	flag.Parse()

	if *showVersion {
		fmt.Println(version)
		return
	}

	dataDir := desktopDataDir()
	if *stop {
		stopInstance(dataDir)
		return
	}

	if err := run(dataDir); err != nil {
		fatal(err.Error())
	}
}

func run(dataDir string) error {
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return fmt.Errorf("create data folder: %w", err)
	}
	statusPath := filepath.Join(dataDir, "launcher.json")
	if existing, err := readStatus(statusPath); err == nil && existing.URL != "" && isHealthy(existing.URL, 800*time.Millisecond) {
		if err := openBrowser(existing.URL); err != nil {
			return err
		}
		fmt.Printf("Service Maestro is already running at %s\n", existing.URL)
		return nil
	}

	resources := resourcesDir()
	nodePath := filepath.Join(resources, "runtime", nodeBinaryName())
	serverEntry := filepath.Join(resources, "app", "packages", "server", "dist", "index.js")
	for _, required := range []string{nodePath, serverEntry} {
		if _, err := os.Stat(required); err != nil {
			return fmt.Errorf("incomplete installation: %s is missing", required)
		}
	}

	for _, dir := range []string{
		"data",
		"library/songs",
		"library/bible",
		"library/images",
		"imports/songselect",
		"logs",
		"ssl",
	} {
		if err := os.MkdirAll(filepath.Join(dataDir, dir), 0o755); err != nil {
			return fmt.Errorf("create %s: %w", dir, err)
		}
	}

	firstRun := !fileExists(filepath.Join(dataDir, "data", "app.sqlite"))
	username, password, credentialsPath := ensureCredentials(dataDir)
	sslEnabled := envBool("SM_SSL_ENABLED", false)
	scheme := "http"
	if sslEnabled {
		scheme = "https"
	}
	port := envPort("SM_PORT", 6111)
	displayPort := envPort("SM_DISPLAY_PORT", port+1)
	if os.Getenv("SM_PORT") == "" {
		port = findFreePort(port)
	}
	if os.Getenv("SM_DISPLAY_PORT") == "" {
		displayPort = findFreePort(displayPort)
		if displayPort == port {
			displayPort = findFreePort(port + 1)
		}
	}

	url := fmt.Sprintf("%s://localhost:%d", scheme, port)
	logPath := filepath.Join(dataDir, "logs", "service-maestro.log")
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("open log file: %w", err)
	}
	defer logFile.Close()

	env := buildEnvironment(dataDir, port, displayPort, password, sslEnabled, scheme)
	cmd := exec.Command(nodePath, serverEntry)
	cmd.Dir = filepath.Join(resources, "app")
	cmd.Env = env
	cmd.Stdout = io.MultiWriter(os.Stdout, logFile)
	cmd.Stderr = io.MultiWriter(os.Stderr, logFile)
	cmd.Stdin = nil

	fmt.Printf("Service Maestro %s\n", version)
	fmt.Printf("Starting server…\n")
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start Service Maestro: %w", err)
	}
	serverPID := cmd.Process.Pid
	status := launchStatus{
		LauncherPID: os.Getpid(),
		ServerPID:   serverPID,
		URL:         url,
		Port:        port,
	}
	_ = writeStatus(statusPath, status)
	defer removeStatus(statusPath, os.Getpid())

	if err := waitForHealth(url, 90*time.Second); err != nil {
		_ = killServer(serverPID)
		_ = cmd.Wait()
		return fmt.Errorf("Service Maestro did not start: %w\nSee %s", err, logPath)
	}

	fmt.Printf("Ready at %s\n", url)
	fmt.Printf("Data: %s\n", dataDir)
	fmt.Printf("Login: %s\n", username)
	if firstRun {
		fmt.Printf("Initial password: %s\n", password)
	}
	fmt.Printf("Credentials file: %s\n", credentialsPath)
	fmt.Printf("Log: %s\n", logPath)
	fmt.Printf("Opening your browser…\n")

	if err := openBrowser(url); err != nil {
		fmt.Printf("Could not open the browser automatically: %v\n", err)
	}

	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()

	if runtime.GOOS == "darwin" {
		return runMacSession(url, credentialsPath, username, password, firstRun, serverPID, done, statusPath)
	}

	fmt.Println("Close this window or press Ctrl+C to stop Service Maestro.")
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	select {
	case err := <-done:
		if err != nil {
			return fmt.Errorf("Service Maestro stopped unexpectedly: %w\nSee %s", err, logPath)
		}
		return nil
	case <-signals:
		fmt.Println("\nStopping Service Maestro…")
		_ = killServer(serverPID)
		select {
		case <-done:
		case <-time.After(5 * time.Second):
		}
		return nil
	}
}

func runMacSession(
	url string,
	credentialsPath string,
	username string,
	password string,
	firstRun bool,
	serverPID int,
	done <-chan error,
	statusPath string,
) error {
	for {
		keepRunning, err := showMacDialog(url, credentialsPath, username, password, firstRun)
		if err != nil {
			fmt.Printf("Dialog error: %v\n", err)
			return nil
		}
		if !keepRunning {
			fmt.Println("Stopping Service Maestro…")
			_ = killServer(serverPID)
			select {
			case <-done:
			case <-time.After(5 * time.Second):
			}
			return nil
		}
		if err := openBrowser(url); err != nil {
			// Browser opening is best-effort; the dialog remains available.
			fmt.Printf("Could not open the browser: %v\n", err)
		}
	}
}

func desktopDataDir() string {
	if value := os.Getenv("SM_DESKTOP_DATA_DIR"); value != "" {
		return value
	}
	if value := os.Getenv("SM_DATA_DIR"); value != "" {
		return value
	}
	base, err := os.UserConfigDir()
	if err != nil || base == "" {
		home, _ := os.UserHomeDir()
		base = filepath.Join(home, ".config")
	}
	switch runtime.GOOS {
	case "windows":
		if value := os.Getenv("LOCALAPPDATA"); value != "" {
			return filepath.Join(value, "ServiceMaestro")
		}
	case "darwin":
		return filepath.Join(base, "Service Maestro")
	default:
		return filepath.Join(base, "service-maestro")
	}
	return filepath.Join(base, "ServiceMaestro")
}

func resourcesDir() string {
	exe, err := os.Executable()
	if err != nil {
		working, _ := os.Getwd()
		return working
	}
	exe, _ = filepath.EvalSymlinks(exe)
	dir := filepath.Dir(exe)
	if runtime.GOOS == "darwin" && filepath.Base(dir) == "MacOS" &&
		filepath.Base(filepath.Dir(dir)) == "Contents" {
		return filepath.Clean(filepath.Join(dir, "..", "Resources"))
	}
	return dir
}

func nodeBinaryName() string {
	if runtime.GOOS == "windows" {
		return "node.exe"
	}
	return "node"
}

func buildEnvironment(
	dataDir string,
	port int,
	displayPort int,
	password string,
	sslEnabled bool,
	scheme string,
) []string {
	values := make(map[string]string)
	for _, entry := range os.Environ() {
		key, value, ok := strings.Cut(entry, "=")
		if ok {
			values[key] = value
		}
	}
	setDefault := func(key, value string) {
		if _, exists := values[key]; !exists {
			values[key] = value
		}
	}
	setDefault("SM_HOST", "127.0.0.1")
	setDefault("SM_PORT", strconv.Itoa(port))
	setDefault("SM_DISPLAY_PORT", strconv.Itoa(displayPort))
	setDefault("SM_DATA_DIR", filepath.Join(dataDir, "data"))
	setDefault("SM_IMAGES_DIR", filepath.Join(dataDir, "library", "images"))
	setDefault("SM_SONGS_DIR", filepath.Join(dataDir, "library", "songs"))
	setDefault("SM_BIBLE_DIR", filepath.Join(dataDir, "library", "bible"))
	setDefault("SM_SONGSELECT_WATCH_DIR", filepath.Join(dataDir, "imports", "songselect"))
	setDefault("SM_SSL_ENABLED", strconv.FormatBool(sslEnabled))
	if !sslEnabled {
		setDefault("SM_SECURE_COOKIES", "false")
	}
	setDefault("SM_SSL_DIR", filepath.Join(dataDir, "ssl"))
	setDefault("SM_SSL_HOSTS", "localhost,127.0.0.1")
	setDefault("SM_WEBAUTHN_RP_ID", "localhost")
	setDefault("SM_WEBAUTHN_ORIGIN", fmt.Sprintf("%s://localhost:%d", scheme, port))
	setDefault("SM_ADMIN_PASSWORD", password)
	setDefault("SM_GIT_ENABLED", "false")
	setDefault("SM_LOG_LEVEL", "info")
	setDefault("SM_ENV_FILE", filepath.Join(dataDir, "desktop.env"))
	env := make([]string, 0, len(values))
	for key, value := range values {
		env = append(env, key+"="+value)
	}
	return env
}

func envBool(key string, fallback bool) bool {
	value := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	if value == "" {
		return fallback
	}
	return value != "0" && value != "false" && value != "no" && value != "off"
}

func envPort(key string, fallback int) int {
	if value := os.Getenv(key); value != "" {
		if port, err := strconv.Atoi(value); err == nil && port > 0 && port <= 65535 {
			return port
		}
	}
	return fallback
}

func findFreePort(start int) int {
	for port := start; port < start+200 && port <= 65535; port++ {
		listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
		if err == nil {
			_ = listener.Close()
			return port
		}
	}
	return start
}

func waitForHealth(url string, timeout time.Duration) error {
	client := &http.Client{
		Timeout: 2 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
	}
	deadline := time.Now().Add(timeout)
	var last error
	for time.Now().Before(deadline) {
		response, err := client.Get(url + "/api/health")
		if err == nil {
			_ = response.Body.Close()
			if response.StatusCode >= 200 && response.StatusCode < 300 {
				return nil
			}
			last = fmt.Errorf("health check returned HTTP %d", response.StatusCode)
		} else {
			last = err
		}
		time.Sleep(400 * time.Millisecond)
	}
	return last
}

func isHealthy(url string, timeout time.Duration) bool {
	return waitForHealth(url, timeout) == nil
}

func ensureCredentials(dataDir string) (string, string, string) {
	path := filepath.Join(dataDir, "credentials.txt")
	username, password := "admin", ""
	if data, err := os.ReadFile(path); err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			key, value, ok := strings.Cut(strings.TrimSpace(line), "=")
			if !ok {
				continue
			}
			switch strings.TrimSpace(key) {
			case "username":
				if value != "" {
					username = strings.TrimSpace(value)
				}
			case "password":
				password = strings.TrimSpace(value)
			}
		}
	}
	if password == "" {
		random := make([]byte, 18)
		if _, err := rand.Read(random); err == nil {
			password = base64.RawURLEncoding.EncodeToString(random)
		} else {
			password = fmt.Sprintf("sm-%d", time.Now().UnixNano())
		}
		content := fmt.Sprintf("username=%s\npassword=%s\n\nChange this password after first login.\n", username, password)
		_ = os.WriteFile(path, []byte(content), 0o600)
	}
	return username, password, path
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func readStatus(path string) (launchStatus, error) {
	var status launchStatus
	data, err := os.ReadFile(path)
	if err != nil {
		return status, err
	}
	err = json.Unmarshal(data, &status)
	return status, err
}

func writeStatus(path string, status launchStatus) error {
	data, err := json.MarshalIndent(status, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o600)
}

func removeStatus(path string, launcherPID int) {
	status, err := readStatus(path)
	if err == nil && status.LauncherPID != launcherPID {
		return
	}
	_ = os.Remove(path)
}

func stopInstance(dataDir string) {
	statusPath := filepath.Join(dataDir, "launcher.json")
	status, err := readStatus(statusPath)
	if err != nil {
		fmt.Println("Service Maestro is not running.")
		return
	}
	_ = killServer(status.ServerPID)
	_ = os.Remove(statusPath)
	fmt.Println("Stopped Service Maestro.")
}

func killServer(pid int) error {
	if pid <= 0 {
		return nil
	}
	process, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	if runtime.GOOS == "windows" {
		return process.Kill()
	}
	_ = process.Signal(syscall.SIGTERM)
	time.Sleep(800 * time.Millisecond)
	_ = process.Kill()
	return nil
}

func openBrowser(url string) error {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		command = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		command = exec.Command("open", url)
	default:
		command = exec.Command("xdg-open", url)
	}
	if err := command.Start(); err != nil {
		return err
	}
	go func() { _ = command.Wait() }()
	return nil
}

func showMacDialog(
	url string,
	credentialsPath string,
	username string,
	password string,
	firstRun bool,
) (bool, error) {
	message := fmt.Sprintf("Service Maestro is running.\n\n%s\n\nLogin: %s", url, username)
	if firstRun {
		message += fmt.Sprintf("\nInitial password: %s", password)
	}
	message += fmt.Sprintf("\n\nCredentials: %s", credentialsPath)
	script := fmt.Sprintf(
		`button returned of (display dialog "%s" buttons {"Quit Service Maestro", "Open Browser"} default button "Open Browser" with title "Service Maestro")`,
		appleScriptString(message),
	)
	output, err := exec.Command("osascript", "-e", script).Output()
	if err != nil {
		return false, nil
	}
	return strings.Contains(string(output), "Open Browser"), nil
}

func appleScriptString(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `"`, `\"`)
	value = strings.ReplaceAll(value, "\n", `" & return & "`)
	return value
}

func fatal(message string) {
	fmt.Fprintln(os.Stderr, "Service Maestro:", message)
	if runtime.GOOS == "darwin" {
		script := fmt.Sprintf(
			`display alert "Service Maestro could not start" message "%s" as critical`,
			appleScriptString(message),
		)
		_ = exec.Command("osascript", "-e", script).Run()
	}
	os.Exit(1)
}
