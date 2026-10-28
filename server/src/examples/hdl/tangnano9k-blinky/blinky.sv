`timescale 1ns / 1ps

// Tang Nano 9K 闪灯：6 个 LED 以二进制显示一个每秒加 COUNT_HZ 次的计数值。
//   · 按住 S1：暂停计数；
//   · 按下 S2：计数清零。
// 板上 LED 低电平点亮、按键按下为 0，所以端口都带 _n 后缀。
module blinky #(
  parameter CLK_HZ   = 27_000_000,  // 输入时钟频率（Hz）
  parameter COUNT_HZ = 4            // 每秒计数次数
) (
  input  logic       clk,           // 27 MHz
  input  logic [1:0] btn_n,         // btn_n[0] = S1，btn_n[1] = S2
  output logic [5:0] led_n          // 低电平点亮
);
  localparam DIV = (CLK_HZ / COUNT_HZ > 1) ? CLK_HZ / COUNT_HZ : 2;
  localparam CW  = $clog2(DIV);

  logic [CW-1:0] div   = '0;
  logic [5:0]    count = '0;
  logic [1:0]    btn_s0 = 2'b11, btn_s = 2'b11;   // 两级同步
  logic          pause, clear;

  always_ff @(posedge clk) begin
    btn_s0 <= btn_n;
    btn_s  <= btn_s0;
  end
  assign pause = ~btn_s[0];
  assign clear = ~btn_s[1];

  always_ff @(posedge clk) begin
    if (clear) begin
      div   <= '0;
      count <= '0;
    end else if (!pause) begin
      if (div == CW'(DIV - 1)) begin
        div   <= '0;
        count <= count + 6'd1;
      end else begin
        div <= div + 1'b1;
      end
    end
  end

  assign led_n = ~count;
endmodule
