@echo off
cls

IF "%1"=="r" (
	echo Release
 	cargo run --release
) ELSE (
	echo Debug
	cargo run
)
